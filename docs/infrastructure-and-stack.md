# Infrastructure and Tech Stack Specifications

> Guide for selecting cloud infrastructure, evaluating Azure versus AWS, structuring the codebase, and launching baseline services before purchasing NFC hardware.

---

## Evaluating Cloud Hosting: Azure versus AWS

Hosting a lightweight Node.js/TypeScript backend alongside a mobile-first web frontend requires evaluating cost, ease of debugging, and infrastructure maintenance overhead.

### Azure Hosting Options

1. **Azure App Service (Linux)**:
   - **How it works**: Managed PaaS hosting Node.js directly from a Git repository or container.
   - **Pros**: Simple continuous deployment via GitHub Actions; automated TLS/SSL certificates; easy custom domain mapping; built-in diagnostic logging and log streaming directly in the portal or VS Code Azure extension.
   - **Cons**: The Free (F1) tier has shared compute and cold start latency; standard production tiers (B1) start at approximately $13/month. Connecting to an Azure PostgreSQL Flexible Server often requires configuring firewall rules or private virtual networks.
   - **Verdict**: A solid, straightforward option if you prefer a unified dashboard with easy log streaming and minimal Docker configuration.

2. **Azure Container Apps**:
   - **How it works**: Serverless container runtime built on Kubernetes (K8s) that abstracts cluster management.
   - **Pros**: Micro-billing (scales down to zero when idle); excellent for keeping costs near zero during development; simple revision management.
   - **Cons**: Requires containerizing the application with Docker and managing an Azure Container Registry (ACR).

---

### AWS Hosting Options

1. **AWS App Runner**:
   - **How it works**: Fully managed container and source-to-service platform designed specifically for web applications and APIs.
   - **Pros**: Direct integration with GitHub; automatic build and deployment; built-in load balancing, TLS, and autoscaling; automatic health checks matching endpoints in [openapi.yaml](file:///c:/Users/alarc/Developer/NFC-Tag/docs/openapi.yaml).
   - **Cons**: Memory and vCPU costs pause when idle only if configured to scale down; minimum baseline cost is around $5 to $7/month when warm.

2. **AWS Lambda with API Gateway**:
   - **How it works**: Serverless functions handling individual HTTP routes.
   - **Pros**: Free tier covers 1 million requests per month; zero cost when not in use.
   - **Cons**: High cold starts; managing persistent PostgreSQL database connection pools requires an RDS Proxy or serverless database adapter; harder to debug locally.

3. **AWS S3 + CloudFront (Frontend) + RDS PostgreSQL (Database)**:
   - **Cons**: Managed RDS PostgreSQL starts at roughly $15 to $25/month for the smallest `db.t4g.micro` instance with storage.

---

### Recommended Infrastructure Setup

To keep operational friction low and debugging simple while building out functions:

| Component | Recommended Tool | Alternative Option |
| :--- | :--- | :--- |
| **Frontend Hosting** | **Vercel** or **AWS S3 + CloudFront** | Azure Static Web Apps |
| **Backend API** | **Azure App Service (B1)** or **AWS App Runner** | Render / Railway / Docker on Azure Container Apps |
| **Database** | **Managed PostgreSQL (Supabase or Neon)** | Azure Flexible Server / AWS RDS Postgres |
| **Object Storage** | **Cloudflare R2** or **AWS S3** | Azure Blob Storage |

> [!TIP]
> Using **Neon** or **Supabase** for PostgreSQL provides a generous free tier, built-in connection pooling, instant schema migrations, and zero local Docker overhead, while remaining 100% compatible with standard PostgreSQL connections in Azure or AWS.

---

## Simulating NFC Taps Without Physical Hardware

You do not need physical NFC stickers to verify routing, onboarding, and canvas editing.

### Simulating the Tap Lifecycle

1. **Testing Tap URLs Directly**:
   - Physical NFC stickers only write standard NDEF URL records (e.g. `https://<domain>/t/:tag_id`).
   - Typing or clicking `http://localhost:3000/t/test_unclaimed_tag` triggers the exact same browser event as tapping a phone against an NTAG213 chip.
2. **Testing Role Switching**:
   - **Unclaimed Tag**: Visiting `/t/tag_empty` launches Flow A (Onboarding).
   - **Claimed Owner**: Visiting `/t/tag_claimed` with `localStorage` containing the minted secret launches Flow B1 (Owner Canvas).
   - **Guest Visitor**: Visiting `/t/tag_claimed` in an incognito window launches Flow B2 (Guest Exhibition).
3. **Simulating Mobile Camera Capture**:
   - The `<input type="file" accept="image/*" capture="environment">` tag opens the camera on mobile devices and a file upload dialog on desktop browsers, allowing instant testing with local painting images.

---

## Codebase Architecture and Organization

To isolate dependencies while keeping development cohesive, a monorepo or two-folder structure works best:

```text
nfc-art-journal/
├── apps/
│   ├── web/                     # Frontend Next.js or React + Vite
│   │   ├── src/
│   │   │   ├── app/             # Routing and pages (/t/:tag_id, /exhibition)
│   │   │   ├── components/      # TipTap editor, camera trigger, modal dialogs
│   │   │   └── lib/             # API client, localStorage secret helper
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── api/                     # Backend Node.js service (Fastify or Express)
│       ├── src/
│       │   ├── routes/          # Endpoints matching openapi.yaml
│       │   ├── services/        # Vision API, Wikipedia REST, LLM prompt engine
│       │   ├── models/          # Domain classes (Tenant, Tag, Item, Entry)
│       │   └── db/              # Database connection and queries
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── db/                      # Shared database schema and migrations
│       ├── prisma/ or drizzle/  # DDL matching data-model.md
│       └── schema.sql
│
├── docs/                        # Specifications, process diagrams, and guides
├── openapi.yaml                 # Authoritative API contract
└── package.json                 # Workspace root scripts
```

---

## Step-by-Step Launch Plan

### Step 1: Bootstrapping the Project Skeleton
1. Initializing the workspace with Node.js and TypeScript.
2. Creating `apps/api` with Fastify or Express.
3. Creating `apps/web` with Next.js or React + Vite.
4. Adding shared TypeScript types generated or referenced from [data-model.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/data-model.md).

### Step 2: Provisioning the Database
1. Launching a PostgreSQL instance (local PostgreSQL or managed via Neon/Supabase).
2. Running the DDL script from [data-model.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/data-model.md) to create tables (`tenants`, `tags`, `items`, `entries`).
3. Seeding an initial tenant (`tenant_01`) and sample test tags (`test_unclaimed`, `test_claimed`).

### Step 3: Deploying the Backend Stub
1. Implementing the health check (`GET /health`) and dispatch endpoint (`GET /api/tags/:tag_id`).
2. Deploying the container or codebase to **Azure App Service** or **AWS App Runner**.
3. Verifying live health responses over HTTPS.

### Step 4: Deploying the Frontend Shell
1. Building the routing dispatcher page for `/t/:tag_id`.
2. Deploying to **Vercel** or **Azure Static Web Apps**.
3. Linking the frontend domain to the backend API.

### Step 5: Testing the End-to-End Pipeline in the Browser
1. Opening the live frontend on a smartphone browser.
2. Navigating to the simulated URL: `https://<frontend-domain>/t/test_unclaimed`.
3. Verifying that the camera trigger opens, snaps a photo, and uploads successfully before ordering physical NFC stickers.
