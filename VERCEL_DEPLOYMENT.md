# Vercel Deployment Guide

This guide will help you deploy the Scanner application to Vercel.

## Prerequisites

1. A Vercel account (create one at [vercel.com](https://vercel.com))
2. Node.js and npm installed locally
3. Azure Storage account for file storage
4. Azure AD App Registration for authentication

## Setup Steps

### 1. Environment Variables

Set up the following environment variables in your Vercel project settings:

- `AZURE_STORAGE_CONNECTION_STRING`: Your Azure Storage connection string
- `AZURE_AD_CLIENT_ID`: Your Azure AD client ID
- `AZURE_AD_TENANT_ID`: Your Azure AD tenant ID
- `AZURE_AD_CLIENT_SECRET`: Your Azure AD client secret (if applicable)

### 2. Deploy to Vercel

You can deploy this project to Vercel in two ways:

#### Using Vercel CLI

1. Install Vercel CLI: `npm install -g vercel`
2. Login to Vercel: `vercel login`
3. Run deployment: `vercel` from the project root

#### Using Vercel GitHub Integration

1. Push your code to GitHub
2. Log into Vercel dashboard
3. Click "Import Project"
4. Select your GitHub repository
5. Configure project settings:
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
6. Click "Deploy"

### 3. API Configuration

The API functions are set up as serverless functions in the `/api` directory. During deployment, Vercel will:

1. Automatically recognize these as serverless API endpoints
2. Deploy them separately from the frontend code
3. Make them available at the `/api/*` routes

### 4. Additional Configuration

For more advanced configuration:

- Edit `vercel.json` to modify routing, functions settings, etc.
- Adjust environment variables in the Vercel dashboard
- Set up custom domains in the Vercel dashboard

## Troubleshooting

If you encounter issues with the deployment:

1. Check Vercel build logs for errors
2. Ensure all environment variables are correctly set
3. Verify API endpoints are properly configured in the code

## Local Development

To develop locally with the Vercel API functions:

1. Install the Vercel CLI: `npm install -g vercel`
2. Run `vercel dev` to start the development server
3. The app will be available at http://localhost:3000

This setup will mimic the Vercel production environment locally, including API functions.
