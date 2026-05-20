# Shree Gopal MDF — Billing & Customer Portal

A production MERN application for an MDF (Medium Density Fibreboard) cutting board business in India. Replaces an Excel-based billing workflow with a web application that supports GST invoices, non-GST bills, temporary estimates, customer-facing order tracking, and role-based staff access.

## Business Context

- MDF cutting board shop in India serving **250–500 customers per month**
- Sells MDF sheets cut to **custom sizes** (rate per square foot)
- Generates:
  - **GST invoices** (HSN 4411, 18% GST)
  - **Non-GST bills**
  - **Temporary estimates**
- Currently solo admin; future roles: cutting, billing, delivery

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 20+, Express 4, Socket.IO 4, Mongoose 8 |
| Database | MongoDB (Atlas in production) |
| Auth | JWT (access + refresh tokens), bcryptjs |
| Validation | Zod (shared between server and clients) |
| Payments | Razorpay, UPI QR codes |
| Notifications | WhatsApp Cloud API, Nodemailer |
| Storage | Cloudinary (images), local disk (PDFs) |
| Admin frontend | React 18, Vite, Redux Toolkit, React Query, Tailwind CSS |
| Customer frontend | React 18, Vite, Tailwind CSS, Framer Motion, PWA |
| PDF generation | @react-pdf/renderer |
| Scheduled jobs | node-cron |

## Folder Structure

```
shree-gopal-mdf-app/
├── backend/              Express + Socket.IO API server
├── admin-dashboard/      React (Vite) app for admin & staff
├── customer-client/      React (Vite) PWA for customers
├── shared/               Shared Zod schemas & constants
├── .gitignore
├── README.md
└── package.json          npm workspaces root
```

## Prerequisites

- **Node.js** ≥ 20 ([download](https://nodejs.org/))
- **npm** ≥ 10 (ships with Node 20)
- **MongoDB** — local install or [Atlas](https://www.mongodb.com/atlas) cluster
- **Git**
- Optional accounts for full feature parity:
  - Razorpay (payments)
  - Meta WhatsApp Business Cloud API
  - Cloudinary (image hosting)
  - SMTP provider (Gmail app password, SendGrid, etc.)

## Setup

```bash
# 1. Clone & install everything (uses npm workspaces)
git clone <repo-url> "shree-gopal-mdf-app"
cd "shree-gopal-mdf-app"
npm install

# 2. Configure backend environment
cd backend
cp .env.example .env
# Edit .env with your credentials

# 3. Run each service in its own terminal (from the repo root)
npm run dev:backend     # http://localhost:5000
npm run dev:admin       # http://localhost:5173
npm run dev:customer    # http://localhost:5174
```

## Scripts Reference

Run from the repo root:

| Script | Description |
| --- | --- |
| `npm run dev:backend` | Start the Express API with nodemon |
| `npm run dev:admin` | Start the admin Vite dev server (port 5173) |
| `npm run dev:customer` | Start the customer Vite dev server (port 5174) |

Each workspace also exposes its own scripts; run them with `npm run <script> --workspace <workspace-name>`.

## Deployment

| Service | Host |
| --- | --- |
| Backend API | [Render](https://render.com/) (web service, Node 20) |
| Admin dashboard | [Vercel](https://vercel.com/) |
| Customer client | [Vercel](https://vercel.com/) |
| Database | [MongoDB Atlas](https://www.mongodb.com/atlas) |
| File storage | [Cloudinary](https://cloudinary.com/) |

Set the production values from `backend/.env.example` in the Render dashboard. Set `VITE_API_BASE_URL` for both Vercel projects to the deployed backend URL.

## License

MIT
