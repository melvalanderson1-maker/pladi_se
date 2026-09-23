// lib/socket.ts
import { io, Socket } from 'socket.io-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

let socket: Socket | null = null

export function conectarSocket(token: string): Socket {
  if (socket?.connected) return socket
  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket'],
  })
  return socket
}

export function desconectarSocket() {
  socket?.disconnect()
  socket = null
}

export function getSocket(): Socket | null {
  return socket
}