const STORAGE_KEY_PREFIX = 'nfc_art_owner_secret_';

/**
 * Retrieving the stored owner secret for a specific tag ID.
 */
export function getOwnerSecret(tagId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${tagId}`);
  } catch {
    return null;
  }
}

/**
 * Saving the owner secret for a specific tag ID to localStorage.
 */
export function setOwnerSecret(tagId: string, secret: string): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tagId}`, secret);
  } catch (err) {
    console.error('Failed saving owner secret to localStorage:', err);
  }
}

/**
 * Removing the stored owner secret for a specific tag ID.
 */
export function clearOwnerSecret(tagId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tagId}`);
  } catch (err) {
    console.error('Failed clearing owner secret from localStorage:', err);
  }
}

/**
 * Inspecting all stored secrets for debugging and simulation purposes.
 */
export function getAllStoredTagSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const tagId = key.replace(STORAGE_KEY_PREFIX, '');
        const val = localStorage.getItem(key);
        if (val) {
          secrets[tagId] = val;
        }
      }
    }
  } catch {
    // Handling private browsing or disabled storage safely
  }
  return secrets;
}
