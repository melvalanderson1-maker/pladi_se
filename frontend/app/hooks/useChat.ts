'use client'
import { useState, useCallback } from 'react'
import { chatStream, ChatMessage, SourceChunk } from '@/lib/api'

export function useChat(documentId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return

      setError(null)

      const userMessage: ChatMessage = { role: 'user', content: question }
      setMessages(prev => [...prev, userMessage])

      const assistantMessage: ChatMessage = { role: 'assistant', content: '' }
      setMessages(prev => [...prev, assistantMessage])

      setIsLoading(true)

      try {
        const history = [...messages, userMessage]

        for await (const event of chatStream(question, documentId, history)) {
          if (event.type === 'token' && event.content) {
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + event.content,
              }
              return updated
            })
          }

          if (event.type === 'done' && event.sources && event.sources.length > 0) {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                sources: event.sources,
              }
              return updated
            })
          }

          if (event.type === 'error') {
            setError(event.content || 'Error desconocido')
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: `Error: ${event.content}`,
              }
              return updated
            })
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Error de conexión'
        setError(errorMsg)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `Lo siento, hubo un error: ${errorMsg}`,
          }
          return updated
        })
      } finally {
        setIsLoading(false)
      }
    },
    [messages, documentId, isLoading]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, isLoading, error, sendMessage, clearMessages }
}