/**
 * Flow A (docs/processes.md, Process 3): first tap onboarding.
 *
 *   check tag is unclaimed -> store image -> run the kind's pipeline (logged)
 *   -> mint owner secret -> insert item + entry and lock the tag atomically
 *
 * The tag is checked before the slow pipeline so a claimed tag fails fast,
 * and checked again inside the claim transaction so a race can't double-claim.
 */

import { ApiError, conflict, notFound } from '../../errors.js';
import type { Entry, Item, ItemKind } from '../../models/types.js';
import type { Repo } from '../../db/repo.js';
import { mintOwnerSecret, newId } from '../auth.js';
import { originalKey, type MediaStore } from '../mediaStore.js';
import { Run, type RunSink } from '../runlog/index.js';
import type { Onboarder } from './types.js';

export const PIPELINE_VERSION = '0.1.0';

export interface OnboardDeps {
  repo: Repo;
  media: MediaStore;
  onboarders: Partial<Record<ItemKind, Onboarder>>;
  runSinks: RunSink[];
}

export interface OnboardItemInput {
  tagId: string;
  kind: ItemKind;
  image: { mime: string; bytes: Buffer };
  titleOverride?: string;
  artistOverride?: string;
}

export interface OnboardItemResult {
  rawOwnerSecret: string;
  item: Item;
  entry: Entry;
  runId: string;
}

export async function onboardItem(deps: OnboardDeps, input: OnboardItemInput): Promise<OnboardItemResult> {
  const tag = await deps.repo.getTag(input.tagId);
  if (!tag) throw notFound('TAG_NOT_FOUND', 'Tag not found');
  if (tag.status !== 'unclaimed') throw conflict('TAG_ALREADY_CLAIMED', 'Tag is already claimed');
  if (tag.kind !== input.kind) throw conflict('WRONG_KIND', `This tag is set up for "${tag.kind}", not "${input.kind}"`);

  const onboarder = deps.onboarders[input.kind];
  if (!onboarder) throw new ApiError(400, 'UNSUPPORTED_KIND', `No onboarding flow for kind "${input.kind}"`);

  const itemId = newId('item');
  const entryId = newId('entry');
  const imageKey = originalKey(tag.tenant_id, itemId, input.image.mime);
  await deps.media.put(imageKey, input.image.mime, input.image.bytes);

  const run = Run.start({
    pipeline: { name: `onboarding.${input.kind}`, version: PIPELINE_VERSION },
    subject: { tenantId: tag.tenant_id, tagId: tag.id, itemId },
    trigger: 'first_tap',
    sinks: deps.runSinks,
  });

  try {
    const outcome = await onboarder(run, {
      tenantId: tag.tenant_id,
      tagId: tag.id,
      imageKey,
      titleOverride: input.titleOverride,
      artistOverride: input.artistOverride,
    });

    const ts = new Date().toISOString();
    const item: Item = {
      id: itemId,
      tenant_id: tag.tenant_id,
      kind: input.kind,
      title: outcome.title,
      artist: outcome.artist,
      year: outcome.year,
      image_url: deps.media.stores ? deps.media.publicUrl(imageKey) : null,
      context: outcome.context,
      // The full step-by-step record lives in the run log; link to it.
      raw_recognition_data: {
        run_id: run.id,
        pipeline_version: PIPELINE_VERSION,
        recognized: outcome.recognized,
        image_key: deps.media.stores ? imageKey : null,
        media_driver: deps.media.driver,
      },
      created_at: ts,
      updated_at: ts,
    };
    const entry: Entry = {
      id: entryId,
      item_id: itemId,
      tenant_id: tag.tenant_id,
      prompts: outcome.prompts,
      content: { type: 'doc', content: [] },
      created_at: ts,
      updated_at: ts,
    };

    const secret = mintOwnerSecret();
    if (!(await deps.repo.claimTag({ tagId: tag.id, ownerTokenHash: secret.hash, item, entry }))) {
      throw conflict('TAG_ALREADY_CLAIMED', 'Tag was claimed by another device during onboarding');
    }

    await run.finish({ itemId, title: item.title, recognized: outcome.recognized });
    return { rawOwnerSecret: secret.raw, item, entry, runId: run.id };
  } catch (err) {
    run.setSubject({ itemId: undefined });
    await run.finish(undefined, 'failed');
    await deps.media.remove(imageKey).catch(() => {});
    throw err;
  }
}
