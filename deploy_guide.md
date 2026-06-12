# Cloud Deployment Guide - Incedo Agentic Control Plane

This guide describes how to deploy the prototype to **Render** (as well as Hugging Face Spaces) so you can share it with others permanently without running any local development server.

The codebase is fully pre-configured for cloud hosting:
1. **Dynamic Port Binding**: `server.py` automatically binds to the `$PORT` environment variable assigned by the cloud platform.
2. **Relative API Routes**: `app.js` uses domain-agnostic relative fetch URLs (e.g. `/api/agent/execute`), meaning it will work out-of-the-box on any public URL.
3. **Containerized Design**: A production-ready `Dockerfile` and `requirements.txt` are included.
4. **Blueprint Deployment**: A `render.yaml` configuration is included for one-click setup on Render.

---

## 🌐 Option A: Deploy to Render (Recommended - Free Web Service Tier)

Render is a developer-friendly cloud hosting platform that can deploy directly from your GitHub repository. By using the provided `render.yaml` Blueprint, Render will automatically provision the service with all the correct settings.

### Step 1: Push Code to GitHub
1. Create a new repository on your GitHub account (e.g., `agentic-control-plane`).
2. Push your local workspace files to the repository:
   - `index.html`
   - `style.css`
   - `app.js`
   - `server.py`
   - `Dockerfile`
   - `requirements.txt`
   - `render.yaml`

### Step 2: Deploy using Render Blueprint
1. Sign up/log in at [Render](https://render.com/).
2. Click **New +** (top right) and select **Blueprint**.
3. Connect your GitHub account and select your `agentic-control-plane` repository.
4. Render will automatically read `render.yaml` and display the **Incedo Agentic Control Plane** service.
5. Scroll to the bottom and click **Apply**.

Render will automatically pull the repository, build the Docker image, assign a dynamic port, and host your live control plane at a public subdomain URL (e.g., `https://incedo-agentic-control-plane.onrender.com`).

---

## 🚀 Option B: Deploy to Hugging Face Spaces (100% Free & Persistent)

Hugging Face Spaces is another excellent free hosting option for Docker containers, running 24/7 with automatically managed SSL.

### Step 1: Create a Space
1. Log into or sign up at [Hugging Face](https://huggingface.co/).
2. Click on **Spaces** in the top navigation bar and select **Create new Space**.
3. Configure your Space:
   * **Space Name**: e.g., `incedo-control-plane`
   * **SDK / License**: Select **Docker** (under Blank Template).
   * **Space Hardware**: Choose **CPU Basic (Free)**.
   * **Visibility**: Select **Public** (so you can share the link).

### Step 2: Push your Files
Upload the following files from your workspace directly via the Hugging Face web interface or via Git:
* `index.html`
* `style.css`
* `app.js`
* `server.py`
* `Dockerfile`
* `requirements.txt`

### Step 3: Build & Run
Hugging Face will automatically detect the `Dockerfile`, build the container, and start running the server. Once the build status shifts to **Running**, your live control plane will be ready!
