# AVISHKAR EMS — Zero-Cost Production Deployment Guide

This guide details how to deploy the AVISHKAR platform for **free** using managed cloud services and instant public tunnels.

---

## 1. Deployed Infrastructure Overview

| Tier | Technology | Hosting / Deployment Strategy | Status / Cost |
|---|---|---|---|
| **Database** | PostgreSQL 18.6 + PostGIS 3.6.4 | **Neon.tech Serverless** | **LIVE & ACTIVE** ($0 / Free Forever) |
| **Optimization Engine** | Python 3.12 (FastAPI / HiGHS MILP) | Render Free Web Service / Local Stack | Configured in `render.yaml` |
| **REST API** | Fastify 5 TypeScript | Render Free Web Service / Local Stack | Configured in `render.yaml` |
| **Web Frontend** | Next.js 16 (React 19 / MapLibre) | Render / Cloudflare Tunnel / Vercel | Configured in `render.yaml` |
| **Live Global Public Access** | Cloudflare Quick Tunnel | Instant secure edge HTTPS | **Zero-Config** ($0 / Free) |

---

## 2. Instant Public Deployment: Cloudflare Quick Tunnel

To expose your entire running application to the global internet with a real HTTPS URL (accessible on phones, laptops, and by evaluators/judges anywhere in the world):

### Run One Command:
```cmd
start-platform-live.cmd
```

### What this does automatically:
1. Connects to the live **Neon Cloud PostgreSQL + PostGIS database**.
2. Starts the **Python Optimization Engine** (:8090) in the background.
3. Starts the **Fastify API** (:8080) in the background.
4. Starts the **Next.js Web Frontend** (:3000) in the background.
5. Launches an authenticated **Cloudflare Quick Tunnel** that exposes port 3000 to a global HTTPS endpoint:
   ```text
   https://<generated-subdomain>.trycloudflare.com
   ```
6. Displays the live HTTPS URL on screen and automatically opens it in your browser.

---

## 3. Persistent 24/7 Cloud Hosting: Render.com Blueprint

To host the platform 24/7 on Render's free cloud infrastructure without running your local PC:

1. Push the repository to GitHub:
   ```bash
   git push origin claude/avishkar-fixes-and-platform
   ```
2. Log into [https://dashboard.render.com](https://dashboard.render.com) using your GitHub account (`ramnivasattanti2008-cloud`).
3. Click **New +** -> **Blueprint**.
4. Select repository **`ramnivasattanti2008-cloud/AVISHKAR-`**.
5. Render reads `render.yaml` and provisions:
   - `avishkar-engine`: Python 3.12 optimization microservice.
   - `avishkar-api`: Fastify API connected to Neon Cloud DB.
   - `avishkar-web`: Next.js web application.
6. Click **Apply** — Render builds and deploys all 3 services for free!

---

## 4. Verification & Diagnostics

At any time, you can verify that the cloud database and platform services are healthy:
```bash
pnpm -C platform/api db:health
```
