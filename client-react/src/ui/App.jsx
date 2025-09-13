import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { generateKeyPair, exportEncryptedPrivateKey, importEncryptedPrivateKey, signChallenge, encryptFor, decryptFrom } from '../crypto.js';
import Whiteboard from './Whiteboard.jsx';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:42069';

export default function App(){
  const [phase, setPhase] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [loginMode, setLoginMode] = useState('new'); // 'new' | 'existing'
  const [users, setUsers] = useState([]);
  const [online, setOnline] = useState([]);
  const [selected, setSelected] = useState(null);
  const [conversations, setConversations] = useState({}); // { otherUser: [ { _id, from, to, body, createdAt } ] }
  const [messagesVersion, setMessagesVersion] = useState(0);
  const [currentView, setCurrentView] = useState('chat'); // 'chat' | 'whiteboard'
  
  // Reset view when selected user changes
  useEffect(() => {
    setCurrentView('chat');
  }, [selected]);
  const persistedLoadedRef = useRef(false);
  const historyFetchedRef = useRef(new Set());
  const fileInputRef = useRef();
  const socketRef = useRef();
  const senderPublicCache = useRef(new Map());

  useEffect(() => {
    const socket = io(WS_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => console.log('Connected socket'));
    socket.on('verify', async ({ challenge }) => {
      try {
        const signed = await signChallenge(challenge, privateKey, password);
        socket.emit('verify_signature', { signed });
      } catch(e){ console.error(e); }
    });
    socket.on('registered', ({ username }) => { setPhase('chat'); });
    socket.on('users', ({ users, online }) => { setUsers(users); setOnline(online); users.forEach(u=> senderPublicCache.current.set(u.username, u.publicKey)); });
    socket.on('message', async ({ _id, from, to, payload, createdAt }) => {
      const senderPub = senderPublicCache.current.get(from);
      if(!senderPub) return;
      try {
        const decrypted = await decryptFrom(payload.armored, privateKey, password, senderPub);
        setConversations(prev => {
          const list = prev[from] ? [...prev[from]] : [];
          if(list.find(m => m._id === _id)) return prev; // dedupe
          list.push({ _id, from, to: username, body: decrypted.data || decrypted.text || decrypted.message || decrypted, createdAt });
          list.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
          const next = { ...prev, [from]: list };
          persistConversations(username, next);
          setMessagesVersion(v=>v+1);
          return next;
        });
      } catch(e){ console.error('decrypt fail', e); }
    });
    socket.on('message_ack', async ({ _id, from, to, payload, createdAt, tempId }) => {
      // Decrypt our own message (we encrypted for self as well)
      const selfPub = senderPublicCache.current.get(from);
      if(!selfPub) return;
      try {
        const decrypted = await decryptFrom(payload.armored, privateKey, password, selfPub);
        setConversations(prev => {
          const list = prev[to] ? [...prev[to]] : [];
          // Replace temp optimistic if present
          const existingIdx = list.findIndex(m => m._id === _id || (tempId && m.tempId === tempId));
          const record = { _id, from, to, body: decrypted.data || decrypted.text || decrypted.message || decrypted, createdAt };
            if(existingIdx >= 0){ list[existingIdx] = record; }
            else { list.push(record); }
          list.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
          const next = { ...prev, [to]: list };
          persistConversations(username, next);
          setMessagesVersion(v=>v+1);
          return next;
        });
      } catch(e){ console.error('decrypt self fail', e); }
    });
  socket.on('history', async ({ messages: hist, withUser }) => {
      if(!withUser) return;
      const out = [];
      for(const m of hist){
    // Always use sender's public key (m.from)
    const theirPub = senderPublicCache.current.get(m.from);
        if(!theirPub) continue;
        try {
          const dec = await decryptFrom(m.payload.armored, privateKey, password, theirPub);
          out.push({ _id: m._id, from: m.from, to: m.to, body: dec.data || dec.message || dec, createdAt: m.createdAt });
        } catch(e) {}
      }
      setConversations(prev => {
        const existing = prev[withUser] ? [...prev[withUser]] : [];
        const ids = new Set(existing.map(m=>m._id));
        for(const m of out){ if(!ids.has(m._id)){ existing.push(m); ids.add(m._id);} }
        existing.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
        const next = { ...prev, [withUser]: existing };
        persistConversations(username, next);
        setMessagesVersion(v=>v+1);
        return next;
      });
    });
    socket.on('error_msg', ({ message }) => alert(message));

    return () => socket.close();
  }, [privateKey, password, username]);

  // Local persistence helpers
  function convKey(user){ return `securechat:${user}:conversations`; }
  function keyWrapperKey(user){ return `securechat:${user}:wrappedKey`; }
  function persistConversations(user, conv){ try { localStorage.setItem(convKey(user), JSON.stringify(conv)); } catch(_){} }
  function loadConversations(user){ try { const v = localStorage.getItem(convKey(user)); return v? JSON.parse(v): {}; } catch(_){ return {}; } }
  function persistWrapped(user, wrapped){ try { localStorage.setItem(keyWrapperKey(user), JSON.stringify(wrapped)); } catch(_){} }
  function loadWrapped(user){ try { const v = localStorage.getItem(keyWrapperKey(user)); return v? JSON.parse(v): null; } catch(_){ return null; } }

  async function handleGenerate(){
    if(!username || !password) return;
    const { privateKey: priv, publicKey: pub } = await generateKeyPair(username, password);
    setPrivateKey(priv); setPublicKey(pub);
    const wrapped = await exportEncryptedPrivateKey(priv, password);
    persistWrapped(username, { wrapped, publicKey: pub });
    setPhase('review');
  }

  async function handleSave(){
    const wrapped = await exportEncryptedPrivateKey(privateKey, password);
    persistWrapped(username, { wrapped, publicKey });
    const blob = new Blob([JSON.stringify({ username, wrapped, publicKey })], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${username}.key.json`; a.click();
  }

  async function handleLoadFile(e){
    const file = e.target.files[0]; if(!file) return;
    if(!password){ alert('Enter the password you originally used before loading the key file.'); return; }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if(!parsed.username || !parsed.wrapped || !parsed.publicKey){
        alert('Invalid key file format'); return;
      }
      setUsername(parsed.username); setPublicKey(parsed.publicKey);
      const priv = await importEncryptedPrivateKey(parsed.wrapped, password);
      setPrivateKey(priv); setPhase('ready');
      persistWrapped(parsed.username, { wrapped: parsed.wrapped, publicKey: parsed.publicKey });
    } catch(err){
      console.error('Key load error', err);
      alert('Failed to load key file. Ensure password is correct and file not modified.');
    }
  }

  function register(){
    socketRef.current.emit('register', { username, publicKey });
  }

  // Load conversations after entering chat once
  useEffect(() => {
    if(phase === 'chat' && username && !persistedLoadedRef.current){
      const cachedConv = loadConversations(username);
      if(Object.keys(cachedConv).length) setConversations(cachedConv);
      persistedLoadedRef.current = true;
    }
  }, [phase, username]);

  async function sendMessage(body){
    if(!selected || !body) return;
    const recipient = users.find(u => u.username === selected);
    if(!recipient) return;
    // Encrypt for both recipient and ourselves so we can decrypt our own ack
    const armored = await encryptFor({ data: body }, [recipient.publicKey, publicKey]);
    const tempId = 'tmp-'+Date.now()+Math.random().toString(36).slice(2,8);
    // Optimistic UI insert
    setConversations(prev => {
      const list = prev[recipient.username] ? [...prev[recipient.username]] : [];
      list.push({ tempId, from: username, to: recipient.username, body, createdAt: new Date().toISOString() });
      const next = { ...prev, [recipient.username]: list };
      persistConversations(username, next);
      setMessagesVersion(v=>v+1);
      return next;
    });
    socketRef.current.emit('send_message', { to: recipient.username, payload: { armored, type: 'chat', tempId } });
  }

  function handleSelectUser(u){
    setSelected(u);
    setCurrentView('chat'); // Reset to chat view when switching users
    if(socketRef.current && username && !historyFetchedRef.current.has(u)){
      socketRef.current.emit('history', { withUser: u, limit: 200 });
      historyFetchedRef.current.add(u);
    }
  }

  function logout(){
    if(socketRef.current){ socketRef.current.emit('logout'); socketRef.current.disconnect(); }
    setPhase('login');
    setSelected(null);
    setConversations({});
    setMessagesVersion(v=>v+1);
  }

  // passwordLogin removed (feature deprecated)

  if(phase === 'login') return (
    <div style={{
      height: '100vh',
      background: 'linear-gradient(135deg, #0a0e13 0%, #161b22 50%, #1a1f26 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Subtle background pattern */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(88, 166, 255, 0.03) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(35, 134, 54, 0.03) 0%, transparent 50%)',
        pointerEvents: 'none'
      }}></div>
      
      <div style={{
        width: 400,
        padding: 28,
        background: 'rgba(22, 27, 34, 0.85)',
        borderRadius: 16,
        border: '1px solid rgba(48, 54, 61, 0.6)',
        backdropFilter: 'blur(20px) saturate(180%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4)',
        transform: 'translateY(0)',
        transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, color: '#f0f6fc', fontWeight: 700, fontSize: 22, letterSpacing: '0.5px' }}>Secure Login</h2>
          <p style={{ margin: '4px 0 0', color: '#8b949e', fontSize: 13, fontWeight: 500 }}>End-to-End Encrypted Chat</p>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(13, 17, 23, 0.8)', borderRadius: 10, border: '1px solid rgba(48, 54, 61, 0.4)' }}>
          <button 
            onClick={() => setLoginMode('new')} 
            style={{
              flex: 1, 
              padding: '8px 14px',
              background: loginMode === 'new' ? 'linear-gradient(135deg, #238636 0%, #2ea043 100%)' : 'transparent',
              color: loginMode === 'new' ? '#fff' : '#e6edf3',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: loginMode === 'new' ? '0 2px 8px rgba(35, 134, 54, 0.4)' : 'none'
            }}
          >
            New User
          </button>
          <button 
            onClick={() => setLoginMode('existing')} 
            style={{
              flex: 1, 
              padding: '8px 14px',
              background: loginMode === 'existing' ? 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)' : 'transparent',
              color: loginMode === 'existing' ? '#fff' : '#e6edf3',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: loginMode === 'existing' ? '0 2px 8px rgba(31, 111, 235, 0.4)' : 'none'
            }}
          >
            Existing User
          </button>
        </div>

        {loginMode === 'new' && (
          <>
            <div style={{ 
              padding: 14, 
              background: 'linear-gradient(135deg, rgba(56, 139, 253, 0.08) 0%, rgba(79, 172, 254, 0.12) 100%)', 
              border: '1px solid rgba(56, 139, 253, 0.2)', 
              borderRadius: 10,
              position: 'relative',
              overflow: 'hidden'
            }}>
              <p style={{ margin: 0, fontSize: 12, color: '#79c0ff', lineHeight: 1.4, fontWeight: 500 }}>
                Create a new identity with a unique username and strong password.
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                  Username
                </label>
                <input 
                  value={username} 
                  onChange={e => setUsername(e.target.value)} 
                  placeholder="Choose a unique username"
                  style={{
                    width: '100%', 
                    padding: '10px 12px',
                    background: 'rgba(13, 17, 23, 0.9)',
                    border: '1px solid rgba(48, 54, 61, 0.8)',
                    borderRadius: 8,
                    color: '#f0f6fc',
                    fontSize: 13,
                    outline: 'none',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    fontWeight: 500
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#58a6ff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(88, 166, 255, 0.1)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'rgba(48, 54, 61, 0.8)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
              
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                  Password
                </label>
                <input 
                  type='password' 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="Enter a strong password"
                  style={{
                    width: '100%', 
                    padding: '10px 12px',
                    background: 'rgba(13, 17, 23, 0.9)',
                    border: '1px solid rgba(48, 54, 61, 0.8)',
                    borderRadius: 8,
                    color: '#f0f6fc',
                    fontSize: 13,
                    outline: 'none',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    fontWeight: 500
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#58a6ff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(88, 166, 255, 0.1)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'rgba(48, 54, 61, 0.8)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>
            
            <button 
              disabled={!username || !password} 
              onClick={handleGenerate}
              style={{
                padding: '12px 18px',
                background: (!username || !password) ? 'rgba(48, 54, 61, 0.5)' : 'linear-gradient(135deg, #238636 0%, #2ea043 100%)',
                color: (!username || !password) ? '#8b949e' : '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: (!username || !password) ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: (!username || !password) ? 'none' : '0 4px 16px rgba(35, 134, 54, 0.3)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase'
              }}
            >
              Generate Keys
            </button>
          </>
        )}

        {loginMode === 'existing' && (
          <>
            <div style={{ 
              padding: 14, 
              background: 'linear-gradient(135deg, rgba(187, 128, 9, 0.08) 0%, rgba(251, 188, 5, 0.12) 100%)', 
              border: '1px solid rgba(187, 128, 9, 0.25)', 
              borderRadius: 10,
              position: 'relative',
              overflow: 'hidden'
            }}>
              <p style={{ margin: 0, fontSize: 12, color: '#f2cc60', lineHeight: 1.4, fontWeight: 500 }}>
                Restore your identity by loading your key file and entering your password.
              </p>
            </div>
            
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                Password
              </label>
              <input 
                type='password' 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="Enter your original password"
                style={{
                  width: '100%', 
                  padding: '10px 12px',
                  background: 'rgba(13, 17, 23, 0.9)',
                  border: '1px solid rgba(48, 54, 61, 0.8)',
                  borderRadius: 8,
                  color: '#f0f6fc',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  fontWeight: 500
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#58a6ff';
                  e.target.style.boxShadow = '0 0 0 3px rgba(88, 166, 255, 0.1)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(48, 54, 61, 0.8)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
            
            <button 
              onClick={() => fileInputRef.current.click()} 
              disabled={!password}
              style={{
                padding: '12px 18px',
                background: !password ? 'rgba(48, 54, 61, 0.5)' : 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)',
                color: !password ? '#8b949e' : '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: !password ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: !password ? 'none' : '0 4px 16px rgba(31, 111, 235, 0.3)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              Load Key File
            </button>
            <input ref={fileInputRef} type='file' style={{ display: 'none' }} onChange={handleLoadFile} />
            
            {username && (
              <div style={{ 
                padding: 10, 
                background: 'linear-gradient(135deg, rgba(46, 160, 67, 0.1) 0%, rgba(35, 134, 54, 0.15) 100%)', 
                border: '1px solid rgba(46, 160, 67, 0.3)', 
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <span style={{ fontSize: 12, color: '#56d364', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  
                  Loaded: <strong>{username}</strong>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if(phase === 'review' || phase === 'ready') return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    }}>
      <div style={{ 
        width: 520, 
        padding: 32, 
        background: 'rgba(22, 27, 34, 0.95)', 
        border: '1px solid rgba(48, 54, 61, 0.8)', 
        borderRadius: 16,
        boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(12px)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: 24, 
            fontWeight: 600, 
            color: '#f0f6fc',
            marginBottom: 8
          }}>
            Keys Ready
          </h3>
          <p style={{ margin: 0, fontSize: 14, color: '#8b949e' }}>
            Your public key is shown below. Keep your private key file secure.
          </p>
        </div>
        
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 14, color: '#f0f6fc', fontWeight: 500 }}>
            Public Key
          </label>
          <textarea 
            readOnly 
            value={publicKey} 
            style={{
              width: '100%', 
              height: 140,
              marginTop: 8,
              padding: 14,
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 8,
              color: '#e6edf3',
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              resize: 'none',
              outline: 'none'
            }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: 12 }}>
          {phase === 'review' && (
            <button 
              onClick={handleSave}
              style={{
                flex: 1,
                padding: '14px 20px',
                background: 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(31, 111, 235, 0.3)'
              }}
            >
              Download Private Key
            </button>
          )}
          <button 
            onClick={() => { setPhase('registered'); register(); }}
            style={{
              flex: 1,
              padding: '14px 20px',
              background: 'linear-gradient(135deg, #238636 0%, #2ea043 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 12px rgba(35, 134, 54, 0.3)'
            }}
          >
            Register & Chat
          </button>
        </div>
      </div>
    </div>
  );

  if(phase === 'registered') return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    }}>
      <div style={{
        padding: 32,
        background: 'rgba(22, 27, 34, 0.95)',
        border: '1px solid rgba(48, 54, 61, 0.8)',
        borderRadius: 16,
        textAlign: 'center',
        boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4)'
      }}>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: '#8b949e' }}>Please wait while we authenticate your identity</p>
      </div>
    </div>
  );

  if(phase === 'chat') return (
    <div style={{ 
      display: 'flex', 
      height: '100vh',
      background: '#0d1117',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    }}>
      <div style={{ 
        width: 300, 
        borderRight: '1px solid rgba(33, 38, 45, 0.8)', 
        background: 'linear-gradient(180deg, #161b22 0%, #1c2128 100%)',
        display: 'flex', 
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Subtle glow effect */}
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 1,
          height: '100%',
          background: 'linear-gradient(180deg, rgba(88, 166, 255, 0.2) 0%, transparent 50%, rgba(35, 134, 54, 0.2) 100%)',
          pointerEvents: 'none'
        }}></div>
        
        <div style={{ 
          padding: 24, 
          borderBottom: '1px solid rgba(33, 38, 45, 0.8)',
          background: 'linear-gradient(135deg, rgba(22, 27, 34, 0.9) 0%, rgba(28, 33, 40, 0.9) 100%)',
          position: 'relative'
        }}>
          <div style={{ 
            fontSize: 20, 
            fontWeight: 700, 
            color: '#f0f6fc',
            marginBottom: 8,
            letterSpacing: '-0.3px'
          }}>
            {username}
          </div>
          <div style={{ 
            fontSize: 13, 
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 500
          }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3fb950 0%, #56d364 100%)',
              boxShadow: '0 0 8px rgba(63, 185, 80, 0.4)'
            }}></div>
            Online
          </div>
        </div>
        
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: 20
        }}>
          <div style={{ 
            fontSize: 12, 
            fontWeight: 700, 
            color: '#9ca3af', 
            marginBottom: 16,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>Contacts</span>
            <span style={{
              background: 'rgba(88, 166, 255, 0.2)',
              color: '#79c0ff',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600
            }}>
              {users.length}
            </span>
          </div>
          {users.map(u => (
            <div 
              key={u.username} 
              onClick={() => handleSelectUser(u.username)} 
              style={{ 
                padding: '14px 16px', 
                marginBottom: 6, 
                borderRadius: 12, 
                cursor: 'pointer', 
                background: selected === u.username 
                  ? 'linear-gradient(135deg, #238636 0%, #2ea043 100%)' 
                  : 'transparent',
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                border: selected === u.username 
                  ? '1px solid rgba(46, 160, 67, 0.5)' 
                  : '1px solid transparent',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={e => {
                if (selected !== u.username) {
                  e.currentTarget.style.background = 'rgba(33, 38, 45, 0.6)';
                  e.currentTarget.style.transform = 'translateX(4px)';
                  e.currentTarget.style.borderColor = 'rgba(88, 166, 255, 0.3)';
                }
              }}
              onMouseLeave={e => {
                if (selected !== u.username) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.transform = 'translateX(0)';
                  e.currentTarget.style.borderColor = 'transparent';
                }
              }}
            >
              {selected === u.username && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: 'linear-gradient(180deg, #56d364 0%, #2ea043 100%)',
                  borderRadius: '0 2px 2px 0'
                }}></div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: selected === u.username 
                    ? 'rgba(255, 255, 255, 0.2)' 
                    : `linear-gradient(135deg, ${
                        u.username.charCodeAt(0) % 2 === 0 
                          ? '#1f6feb, #58a6ff' 
                          : '#238636, #2ea043'
                      })`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#fff',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
                }}>
                  {u.username.charAt(0).toUpperCase()}
                </div>
                
                <span style={{ 
                  color: selected === u.username ? '#fff' : '#e6edf3',
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '-0.2px'
                }}>
                  {u.username}
                </span>
              </div>
              
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: online.includes(u.username) 
                  ? 'linear-gradient(135deg, #3fb950 0%, #56d364 100%)' 
                  : 'linear-gradient(135deg, #6e7681 0%, #8b949e 100%)',
                transition: 'all 0.3s ease',
                flexShrink: 0,
                boxShadow: online.includes(u.username) 
                  ? '0 0 8px rgba(63, 185, 80, 0.4)' 
                  : 'none'
              }}></div>
            </div>
          ))}
        </div>
      </div>
      
      {currentView === 'chat' ? (
        <ChatPane 
          username={username} 
          selected={selected} 
          conversation={selected ? (conversations[selected] || []) : []} 
          onSend={sendMessage} 
          onToggleWhiteboard={() => setCurrentView('whiteboard')}
          onLogout={logout}
          key={messagesVersion} 
        />
      ) : (
        <Whiteboard
          username={username}
          selected={selected}
          socket={socketRef.current}
          onBack={() => setCurrentView('chat')}
        />
      )}
    </div>
  );
}

function ChatPane({ username, selected, conversation, onSend, onToggleWhiteboard, onLogout }){
  const [draft, setDraft] = useState('');
  const listRef = useRef();
  useEffect(() => { if(listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [conversation]);
  
  if(!selected) return (
    <div style={{
      flex: 1, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: '#0d1117',
      flexDirection: 'column',
      gap: 16
    }}>
      <div style={{ fontSize: 64 }}>💬</div>
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f0f6fc' }}>
          Welcome to SecureChat
        </h3>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: '#8b949e' }}>
          Select a user from the sidebar to start chatting
        </p>
      </div>
    </div>
  );
  
  return (
    <div style={{
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column',
      background: '#0d1117'
    }}>
      <div style={{ 
        padding: 24, 
        borderBottom: '1px solid rgba(33, 38, 45, 0.8)',
        background: 'linear-gradient(135deg, rgba(22, 27, 34, 0.95) 0%, rgba(28, 33, 40, 0.95) 100%)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'relative'
      }}>
        {/* Subtle top highlight */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(88, 166, 255, 0.3), transparent)'
        }}></div>
        
        <div style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${
            selected.charCodeAt(0) % 2 === 0 
              ? '#1f6feb, #58a6ff' 
              : '#238636, #2ea043'
          })`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          fontWeight: 700,
          color: '#fff',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(255, 255, 255, 0.1)',
          position: 'relative'
        }}>
          {selected.charAt(0).toUpperCase()}
          <div style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3fb950 0%, #56d364 100%)',
            border: '2px solid #161b22',
            boxShadow: '0 0 8px rgba(63, 185, 80, 0.5)'
          }}></div>
        </div>
        
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f6fc', marginBottom: 2, letterSpacing: '-0.3px' }}>
            {selected}
          </div>
          <div style={{ 
            fontSize: 13, 
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 500
          }}>
            End-to-end encrypted
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {selected && (
            <button
              onClick={onToggleWhiteboard}
              style={{
                padding: '8px 16px',
                background: 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(31, 111, 235, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              onMouseEnter={e => {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 12px rgba(31, 111, 235, 0.4)';
              }}
              onMouseLeave={e => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 8px rgba(31, 111, 235, 0.3)';
              }}
            >
              <span style={{ fontSize: 14 }}>🎨</span>
              Whiteboard
            </button>
          )}
          
          <button 
            onClick={onLogout} 
            style={{ 
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #da3633 0%, #f85149 100%)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(218, 54, 51, 0.3)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={e => {
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 4px 12px rgba(218, 54, 51, 0.4)';
            }}
            onMouseLeave={e => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 2px 8px rgba(218, 54, 51, 0.3)';
            }}
          >
            Logout
          </button>
        </div>
      </div>
      
      <div 
        ref={listRef} 
        style={{
          flex: 1, 
          overflowY: 'auto', 
          padding: 20, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 12
        }}
      >
        {conversation.map((m, i) => (
          <div 
            key={i} 
            style={{ 
              alignSelf: m.from === username ? 'flex-end' : 'flex-start', 
              maxWidth: '70%',
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <div style={{
              background: m.from === username 
                ? 'linear-gradient(135deg, #238636 0%, #2ea043 100%)' 
                : '#21262d',
              color: m.from === username ? '#fff' : '#e6edf3',
              padding: '12px 16px',
              borderRadius: 16,
              fontSize: 14,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              boxShadow: m.from === username 
                ? '0 4px 12px rgba(35, 134, 54, 0.3)' 
                : '0 2px 8px rgba(0, 0, 0, 0.2)',
              border: m.from === username ? 'none' : '1px solid #30363d'
            }}>
              {m.body}
            </div>
            {m.createdAt && (
              <div style={{
                fontSize: 11,
                color: '#6e7681',
                alignSelf: m.from === username ? 'flex-end' : 'flex-start',
                marginTop: -2
              }}>
                {new Date(m.createdAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        ))}
      </div>
      
      <form 
        onSubmit={e => { e.preventDefault(); onSend(draft); setDraft(''); }} 
        style={{ 
          display: 'flex', 
          gap: 12, 
          padding: 20,
          borderTop: '1px solid #21262d',
          background: '#161b22'
        }}
      >
        <input 
          value={draft} 
          onChange={e => setDraft(e.target.value)} 
          placeholder={`Message ${selected}...`}
          style={{
            flex: 1, 
            padding: '16px 20px',
            background: 'rgba(13, 17, 23, 0.9)',
            color: '#f0f6fc',
            border: '2px solid rgba(48, 54, 61, 0.6)',
            borderRadius: 28,
            fontSize: 15,
            outline: 'none',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            fontWeight: 500
          }}
          onFocus={e => {
            e.target.style.borderColor = '#58a6ff';
            e.target.style.boxShadow = '0 0 0 3px rgba(88, 166, 255, 0.1)';
            e.target.style.transform = 'translateY(-1px)';
          }}
          onBlur={e => {
            e.target.style.borderColor = 'rgba(48, 54, 61, 0.6)';
            e.target.style.boxShadow = 'none';
            e.target.style.transform = 'translateY(0)';
          }}
        />
        <button 
          type="submit"
          disabled={!draft.trim()}
          style={{ 
            padding: '16px 24px',
            background: !draft.trim() 
              ? 'rgba(48, 54, 61, 0.5)' 
              : 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)',
            color: !draft.trim() ? '#8b949e' : '#fff',
            border: 'none',
            borderRadius: 28,
            fontSize: 15,
            fontWeight: 700,
            cursor: !draft.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: !draft.trim() 
              ? 'none' 
              : '0 4px 16px rgba(31, 111, 235, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 80
          }}
          onMouseEnter={e => {
            if (draft.trim()) {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 8px 24px rgba(31, 111, 235, 0.5)';
            }
          }}
          onMouseLeave={e => {
            if (draft.trim()) {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 16px rgba(31, 111, 235, 0.4)';
            }
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
