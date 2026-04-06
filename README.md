# chatflow

Real-time chat application for the Adverayze technical assignment.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express + Socket.IO
- Database: MongoDB Atlas
- Auth: JWT with username/password

## Features

- Send and fetch messages
- Delete for me
- Delete for everyone
- Pin and unpin messages
- Live updates through Socket.IO
- Persistent data in MongoDB

## Project Structure

- `client/` React UI
- `server/` API, auth, and WebSocket server

## Setup

1. Install dependencies at the repo root:

	`npm install`

2. Create environment files:

	- `server/.env` from `server/.env.example`
	- `client/.env` from `client/.env.example`

3. Add your MongoDB Atlas connection string and JWT secret in `server/.env`.

4. Start both apps:

	`npm run dev`

## Environment Variables

Server:

- `PORT` - server port, default `5000`
- `CLIENT_ORIGIN` - frontend origin for CORS and Socket.IO
- `MONGO_URI` - MongoDB Atlas connection string
- `JWT_SECRET` - secret used to sign auth tokens

Client:

- `VITE_API_URL` - backend URL, default `http://localhost:5000`

## API

### Auth

- `POST /api/auth/register` with `{ username, password }`
- `POST /api/auth/login` with `{ username, password }`

### Messages

- `GET /api/messages` - list visible messages for the authenticated user
- `POST /api/messages` with `{ content }` - create a message
- `DELETE /api/messages/:id/me` - hide a message for the current user
- `DELETE /api/messages/:id/everyone` - delete a message for everyone
- `PATCH /api/messages/:id/pin` with `{ pinned: true|false }` - toggle pin state

## Design Decisions

- JWT keeps the implementation simple enough for a 4-hour challenge while still supporting multiple users.
- Socket.IO is used instead of polling so updates appear immediately after message changes.
- Messages are stored in MongoDB with flags for pinning and deletion to support persistence after refresh.

## Tradeoffs

- Authentication is intentionally lightweight: username/password only, no password recovery or account management.
- Delete-for-me is implemented as a per-user hidden flag instead of a separate message copy.
- The app focuses on the assignment scope rather than advanced features like read receipts or typing indicators.

## Deployment Notes

- Frontend can be deployed to Vercel or Netlify.
- Backend can be deployed to Render or Railway.
- Set the backend `CLIENT_ORIGIN` to your deployed frontend URL and the client `VITE_API_URL` to your backend URL.
