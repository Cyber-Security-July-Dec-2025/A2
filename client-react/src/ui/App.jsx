import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { generateKeyPair, exportEncryptedPrivateKey, importEncryptedPrivateKey, signChallenge, encryptFor, decryptFrom } from '../crypto.js';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:42069';

export default function App(){
  const [phase, setPhase] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [users, setUsers] = useState([]); // {username, publicKey}
  const [online, setOnline] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]); // {from, to, body}
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
    socket.on('message', async ({ from, payload }) => {
      // payload is { armored } or we stored as encrypted blob originally; server passes through JSON structure
      const senderPub = senderPublicCache.current.get(from);
      if(!senderPub) return;
      try {
        const decrypted = await decryptFrom(payload.armored, privateKey, password, senderPub);
        setMessages(m => [...m, { from, to: username, body: decrypted.data || decrypted.text || decrypted.message || decrypted }]);
      } catch(e){ console.error('decrypt fail', e); }
    });
    socket.on('history', async ({ messages: hist }) => {
      const out = [];
      for(const m of hist){
        const theirPub = senderPublicCache.current.get(m.from === username ? m.to : m.from);
        if(!theirPub) continue;
        try { const dec = await decryptFrom(m.payload.armored, privateKey, password, theirPub); out.push({ from: m.from, to: m.to, body: dec.data || dec.message || dec }); } catch(e) {}
      }
      setMessages(out);
    });
    socket.on('error_msg', ({ message }) => alert(message));

    return () => socket.close();
  }, [privateKey, password, username]);

  async function handleGenerate(){
    if(!username || !password) return;
    const { privateKey: priv, publicKey: pub } = await generateKeyPair(username, password);
    setPrivateKey(priv); setPublicKey(pub);
    setPhase('review');
  }

  async function handleSave(){
    const wrapped = await exportEncryptedPrivateKey(privateKey, password);
    const blob = new Blob([JSON.stringify({ username, wrapped, publicKey })], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${username}.key.json`; a.click();
  }

  async function handleLoadFile(e){
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    setUsername(parsed.username); setPublicKey(parsed.publicKey);
    const priv = await importEncryptedPrivateKey(parsed.wrapped, password);
    setPrivateKey(priv); setPhase('ready');
  }

  function register(){
    socketRef.current.emit('register', { username, publicKey });
  }

  async function sendMessage(body){
    if(!selected || !body) return;
    const recipient = users.find(u => u.username === selected);
    if(!recipient) return;
    const armored = await encryptFor({ data: body }, recipient.publicKey);
    socketRef.current.emit('send_message', { to: recipient.username, payload: { armored, type: 'chat' } });
    setMessages(m => [...m, { from: username, to: recipient.username, body }]);
  }

  if(phase === 'login') return (
    <div className="center">
      <div style={{ width:360, padding:24, background:'#161b22', border:'1px solid #30363d', borderRadius:8 }}>
        <h2 style={{marginTop:0}}>Secure Chat Login</h2>
        <label>Username<br /><input value={username} onChange={e=>setUsername(e.target.value)} style={{width:'100%'}} /></label><br />
        <label>Password<br /><input type='password' value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%'}} /></label><br />
        <div style={{display:'flex', gap:8, marginTop:12}}>
          <button onClick={handleGenerate} style={{flex:1}}>Generate Keys</button>
          <button onClick={()=>fileInputRef.current.click()} style={{flex:1}}>Load Key File</button>
          <input ref={fileInputRef} type='file' style={{display:'none'}} onChange={handleLoadFile} />
        </div>
      </div>
    </div>
  );

  if(phase === 'review' || phase === 'ready') return (
    <div className='center'>
      <div style={{ width:480, padding:24, background:'#161b22', border:'1px solid #30363d', borderRadius:8 }}>
        <h3>Key Ready</h3>
        <textarea readOnly value={publicKey} style={{width:'100%', height:120}} />
        <div style={{display:'flex', gap:8, marginTop:12}}>
          {phase==='review' && <button onClick={handleSave}>Download Private Key</button>}
          <button onClick={()=>{ setPhase('registered'); register(); }}>Register</button>
        </div>
      </div>
    </div>
  );

  if(phase === 'registered') return <div className='center'><p>Verifying signature...</p></div>;

  if(phase === 'chat') return (
    <div style={{ display:'flex', height:'100vh' }}>
      <div style={{ width:240, borderRight:'1px solid #30363d', padding:12, display:'flex', flexDirection:'column', gap:12 }}>
        <div><strong>{username}</strong></div>
        <div style={{flex:1, overflowY:'auto'}}>
          {users.map(u => (
            <div key={u.username} onClick={()=>setSelected(u.username)} style={{ padding:6, marginBottom:4, borderRadius:4, cursor:'pointer', background: selected===u.username?'#238636':'#21262d', display:'flex', justifyContent:'space-between' }}>
              <span>{u.username}</span>
              <span style={{width:8,height:8,borderRadius:4, alignSelf:'center', background: online.includes(u.username)?'#3fb950':'#6e7681'}}></span>
            </div>
          ))}
        </div>
      </div>
      <ChatPane username={username} selected={selected} messages={messages.filter(m => (m.from===selected && m.to===username) || (m.from===username && m.to===selected))} onSend={sendMessage} />
    </div>
  );
}

function ChatPane({ username, selected, messages, onSend }){
  const [draft, setDraft] = useState('');
  const listRef = useRef();
  useEffect(() => { if(listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);
  if(!selected) return <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center'}}>Select a user</div>;
  return (
    <div style={{flex:1, display:'flex', flexDirection:'column'}}>
      <div style={{ padding:12, borderBottom:'1px solid #30363d'}}><strong>Chat with {selected}</strong></div>
      <div ref={listRef} style={{flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:6}}>
        {messages.map((m,i) => (
          <div key={i} style={{ alignSelf: m.from===username?'flex-end':'flex-start', maxWidth:'60%', background: m.from===username?'#238636':'#30363d', padding:'8px 10px', borderRadius:8, whiteSpace:'pre-wrap', fontSize:14 }}>{m.body}</div>
        ))}
      </div>
      <form onSubmit={e=>{ e.preventDefault(); onSend(draft); setDraft(''); }} style={{ display:'flex', gap:8, padding:12 }}>
        <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder='Message...' style={{flex:1, padding:8, background:'#0d1117', color:'#e6edf3', border:'1px solid #30363d', borderRadius:6}} />
        <button style={{ padding:'8px 16px' }}>Send</button>
      </form>
    </div>
  );
}
