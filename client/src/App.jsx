import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function formatTime(value) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readSession() {
  try {
    const token = localStorage.getItem('chatflow_token');
    const user = JSON.parse(localStorage.getItem('chatflow_user') || 'null');
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

function getPartnerFromConversation(conversation, currentUserId) {
  if (!conversation) {
    return null;
  }

  return conversation.partner || conversation.participants?.find((participant) => participant._id !== currentUserId) || null;
}

function sortByTime(messages) {
  return [...messages].sort((left, right) => {
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const [mode, setMode] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const socketRef = useRef(null);
  const activeConversationRef = useRef(null);
  const menuLayerRef = useRef(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const pinnedMessages = useMemo(
    () => sortByTime(messages.filter((message) => message.pinned && !message.deletedForEveryone)),
    [messages],
  );

  const visibleMessages = useMemo(
    () => sortByTime(messages.filter((message) => !message.deletedForEveryone)),
    [messages],
  );

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (session.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || 'Request failed');
    }

    return data;
  }

  async function loadUsers() {
    const data = await request('/api/users');
    setUsers(data.users);
    return data;
  }

  async function loadConversations() {
    const data = await request('/api/conversations');
    setConversations(data.conversations);
    return data;
  }

  async function loadMessages(conversationId) {
    if (!conversationId) {
      setMessages([]);
      return { messages: [] };
    }

    const data = await request(`/api/messages?conversationId=${conversationId}`);
    setMessages(data.messages);
    return data;
  }

  useEffect(() => {
    if (!session.token) {
      setUsers([]);
      setConversations([]);
      setActiveConversation(null);
      setMessages([]);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    let cancelled = false;

    Promise.all([loadUsers(), loadConversations()])
      .then(([usersData, conversationsData]) => {
        if (cancelled) {
          return;
        }

        setUsers(usersData.users);
        setConversations(conversationsData.conversations);

        if (conversationsData.conversations.length > 0) {
          setActiveConversation(conversationsData.conversations[0]);
        }
      })
      .catch((error) => setChatError(error.message));

    const socket = io(API_URL, {
      auth: { token: session.token },
    });

    socket.on('connect_error', (error) => setChatError(error.message));
    socket.on('messages:updated', () => {
      const currentConversation = activeConversationRef.current;
      if (currentConversation?._id) {
        loadMessages(currentConversation._id).catch((error) => setChatError(error.message));
        loadConversations().catch((error) => setChatError(error.message));
      }
    });

    socketRef.current = socket;

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [session.token]);

  useEffect(() => {
    if (!session.token || !activeConversation?._id) {
      setMessages([]);
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit('join:conversation', activeConversation._id);
    }

    loadMessages(activeConversation._id).catch((error) => setChatError(error.message));
  }, [session.token, activeConversation?._id]);

  useEffect(() => {
    setOpenMenuId(null);
  }, [activeConversation?._id]);

  useEffect(() => {
    if (!openMenuId) {
      return undefined;
    }

    function onPointerDown(event) {
      if (!menuLayerRef.current) {
        return;
      }

      const activeMenuWrap = menuLayerRef.current.querySelector('.message-card.menu-open .message-menu-wrap');

      if (!activeMenuWrap) {
        setOpenMenuId(null);
        return;
      }

      if (!activeMenuWrap.contains(event.target)) {
        setOpenMenuId(null);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenuId]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');
    setLoading(true);

    try {
      const data = await request(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(authForm),
      });

      const nextSession = { token: data.token, user: data.user };
      setSession(nextSession);
      localStorage.setItem('chatflow_token', data.token);
      localStorage.setItem('chatflow_user', JSON.stringify(data.user));
      setActiveConversation(null);
      setConversations([]);
      setUsers([]);
      setMessages([]);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function openConversationWithUser(user) {
    try {
      setChatError('');
      const data = await request('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ partnerId: user._id }),
      });

      const conversation = {
        ...data.conversation,
        partner: user,
      };

      setActiveConversation(conversation);

      const refreshed = await loadConversations();
      const foundConversation = refreshed.conversations.find((item) => item._id === conversation._id);
      if (foundConversation) {
        setActiveConversation(foundConversation);
      }
    } catch (error) {
      setChatError(error.message);
    }
  }

  function selectConversation(conversation) {
    setActiveConversation(conversation);
  }

  async function sendMessage(event) {
    event.preventDefault();

    const content = messageText.trim();
    if (!content || !activeConversation?._id) {
      return;
    }

    setChatError('');
    setMessageText('');

    try {
      await request('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          content,
          conversationId: activeConversation._id,
        }),
      });

      await loadMessages(activeConversation._id);
      const refreshed = await loadConversations();
      const refreshedConversation = refreshed.conversations.find((item) => item._id === activeConversation._id);
      if (refreshedConversation) {
        setActiveConversation(refreshedConversation);
      }
    } catch (error) {
      setChatError(error.message);
      setMessageText(content);
    }
  }

  async function deleteForMe(messageId) {
    try {
      await request(`/api/messages/${messageId}/me`, { method: 'DELETE' });
      setMessages((previousMessages) => previousMessages.filter((message) => message._id !== messageId));
      setOpenMenuId(null);
      await loadMessages(activeConversation?._id);
    } catch (error) {
      setChatError(error.message);
    }
  }

  async function deleteForEveryone(messageId) {
    try {
      await request(`/api/messages/${messageId}/everyone`, { method: 'DELETE' });
      setMessages((previousMessages) => previousMessages.filter((message) => message._id !== messageId));
      setOpenMenuId(null);
      await loadMessages(activeConversation?._id);
    } catch (error) {
      setChatError(error.message);
    }
  }

  async function togglePin(messageId, pinned) {
    try {
      await request(`/api/messages/${messageId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !pinned }),
      });
      setOpenMenuId(null);
      await loadMessages(activeConversation?._id);
    } catch (error) {
      setChatError(error.message);
    }
  }

  function logout() {
    localStorage.removeItem('chatflow_token');
    localStorage.removeItem('chatflow_user');
    setSession({ token: null, user: null });
    setUsers([]);
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
  }

  const filteredUsers = users.filter((user) => user.username.toLowerCase().includes(searchTerm.toLowerCase()));
  const activePartner = getPartnerFromConversation(activeConversation, session.user?.id);
  const activePinnedBanner = pinnedMessages[0] || null;

  if (!session.token) {
    return (
      <div className="page shell auth-shell">
        <div className="auth-card">
          <div className="badge">Adverayze Assignment</div>
          <h1>Chatflow</h1>
          <p className="muted">1-to-1 direct chat like WhatsApp, with live updates, pinning, and delete-for-me/delete-for-everyone.</p>

          <div className="segmented">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label>
              Username
              <input value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} placeholder="meera" autoComplete="username" />
            </label>
            <label>
              Password
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>

            {authError ? <div className="error-banner">{authError}</div> : null}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? 'Working...' : mode === 'login' ? 'Login' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page shell whatsapp-shell whatsapp-layout">
      <aside className="sidebar">
        <div className="profile-card">
          <div>
            <div className="badge">Signed in</div>
            <h2>{session.user?.username}</h2>
            <p className="muted">Choose a contact to open a private thread.</p>
          </div>
          <button className="secondary-button" onClick={logout}>Logout</button>
        </div>

        <section className="panel panel-chats">
          <div className="panel-title">Chats</div>
          <div className="conversation-list">
            {conversations.length === 0 ? <p className="muted small">No chats yet. Start one below.</p> : null}
            {conversations.map((conversation) => {
              const partner = getPartnerFromConversation(conversation, session.user?.id);
              const isActive = activeConversation?._id === conversation._id;

              return (
                <button
                  key={conversation._id}
                  type="button"
                  className={`conversation-item ${isActive ? 'active' : ''}`}
                  onClick={() => selectConversation(conversation)}
                >
                  <div>
                    <strong>{partner?.username || 'Unknown user'}</strong>
                    <span>{conversation.lastMessage?.content || 'No messages yet'}</span>
                  </div>
                  <small>{conversation.lastMessageAt ? formatTime(conversation.lastMessageAt) : ''}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel panel-start">
          <div className="panel-title">Start new chat</div>
          <input
            className="search-input"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search users"
          />
          <div className="user-list">
            {filteredUsers.length === 0 ? <p className="muted small">No matching users.</p> : null}
            {filteredUsers.map((user) => (
              <button key={user._id} type="button" className="user-item" onClick={() => openConversationWithUser(user)}>
                {user.username}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="chat-card whatsapp-chat">
        <header className="chat-header">
          <div>
            <div className="badge subtle">Direct message</div>
            <h1>{activePartner?.username || 'Select a chat'}</h1>
            <p className="muted">{activePartner ? `Chatting privately with ${activePartner.username}` : 'Choose a user or a chat from the sidebar.'}</p>
          </div>
          <p className="muted">{visibleMessages.length} messages</p>
        </header>

        {activePinnedBanner ? (
          <div className="pinned-banner">
            <div className="pinned-banner__label">Pinned message</div>
            <div className="pinned-banner__body">
              <strong>{activePinnedBanner.sender.username}</strong>
              <span>{activePinnedBanner.content}</span>
            </div>
          </div>
        ) : null}

        {chatError ? <div className="error-banner">{chatError}</div> : null}

        <div className="message-list" ref={menuLayerRef}>
          {!activeConversation?._id ? <div className="empty-state">Select a contact to start messaging.</div> : null}
          {visibleMessages.map((message) => {
            const isMine = message.sender._id === session.user?.id;
            const isMenuOpen = openMenuId === message._id;

            return (
              <article key={message._id} className={`message-card dm-message ${isMine ? 'mine' : 'theirs'} ${message.deletedForEveryone ? 'deleted' : ''} ${message.pinned ? 'pinned' : ''} ${isMenuOpen ? 'menu-open' : ''}`}>
                <div className="message-top">
                  <div>
                    <strong>{isMine ? 'You' : message.sender.username}</strong>
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                  <div className="message-menu-wrap">
                    <button
                      type="button"
                      className="message-menu-trigger"
                      onClick={() => setOpenMenuId(isMenuOpen ? null : message._id)}
                      aria-label="Message actions"
                    >
                      <span />
                      <span />
                      <span />
                    </button>

                    {isMenuOpen ? (
                      <div className="message-menu">
                        <button type="button" onClick={() => togglePin(message._id, message.pinned)}>
                          {message.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button type="button" onClick={() => deleteForMe(message._id)}>
                          Delete for me
                        </button>
                        {isMine && !message.deletedForEveryone ? (
                          <button type="button" onClick={() => deleteForEveryone(message._id)}>
                            Delete for everyone
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <p>{message.deletedForEveryone ? 'Message deleted for everyone.' : message.content}</p>
              </article>
            );
          })}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder={activeConversation?._id ? 'Type a message...' : 'Select a chat first'}
            maxLength={500}
            disabled={!activeConversation?._id}
          />
          <button className="primary-button" type="submit" disabled={!activeConversation?._id}>
            Send
          </button>
        </form>

      </main>
    </div>
  );
}
