import { createContext, useContext, useState } from 'react'

/**
 * ChatContext — global state for the single-panel-at-a-time chart chat.
 * Any ChartCard can call openChat({ title, chartType, dateRange, chartData })
 * to open the panel for that specific chart, automatically closing any other.
 */
const ChatContext = createContext(null)

export function ChatProvider({ children }) {
  const [chat, setChat] = useState(null) // null = closed, else { title, chartType, dateRange, chartData }

  const openChat = (config) => setChat(config)
  const closeChat = () => setChat(null)

  return (
    <ChatContext.Provider value={{ chat, openChat, closeChat }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  return useContext(ChatContext)
}
