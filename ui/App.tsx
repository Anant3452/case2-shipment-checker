import { useState } from 'react';
import { Chat } from './Chat';
import { Upload } from './Upload';

type Tab = 'chat' | 'upload';

export function App() {
  const [tab, setTab] = useState<Tab>('chat');
  return (
    <div className="app">
      <header>
        <h1>Shipment booking checker</h1>
        <p className="tagline">UK to Germany, France and the Netherlands. Catch mistakes before the shipment leaves.</p>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}>Describe a shipment</button>
          <button role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'tab active' : 'tab'} onClick={() => setTab('upload')}>Upload sheets</button>
        </nav>
      </header>
      <main>{tab === 'chat' ? <Chat /> : <Upload />}</main>
      <footer className="muted">No login, no cookies. Your data is not stored after the session.</footer>
    </div>
  );
}
