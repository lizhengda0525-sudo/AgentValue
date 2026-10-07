import React, { useEffect, useState } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { createRoot } from 'react-dom/client';
import Workbench from './assistant/Workbench';
import { SyncShell } from './sync/SyncPanel';
import './style.css';
import './readability.css';
import './components.css';
import './typography.css';
dayjs.locale('zh-cn');
if (import.meta.env.VITE_STANDALONE === 'true' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
function Root() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    document.title = 'AgentValue';
    const reload = () => setGeneration((value) => value + 1);
    window.addEventListener('agentvalue-restored', reload);
    window.addEventListener('agentvalue-reload', reload);
    window.addEventListener('agentvalue-workspace', reload);
    return () => {
      window.removeEventListener('agentvalue-restored', reload);
      window.removeEventListener('agentvalue-reload', reload);
      window.removeEventListener('agentvalue-workspace', reload);
    };
  }, []);
  return <Workbench key={generation} />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#557b65',
          colorInfo: '#557b65',
          colorText: '#27372e',
          colorBorder: '#dce4dd',
          borderRadius: 8,
          controlHeight: 36,
          fontFamily: 'MiSans, sans-serif',
          fontFamilyCode: 'MiSans, sans-serif',
          fontSize: 14,
          fontSizeSM: 13,
          fontSizeLG: 16,
          fontSizeXL: 20,
          fontSizeHeading1: 24,
          fontSizeHeading2: 20,
          fontSizeHeading3: 16,
          fontSizeHeading4: 16,
          fontSizeHeading5: 14,
          fontWeightStrong: 600,
          lineHeight: 1.5,
        },
        components: {
          Button: { primaryShadow: 'none' },
          Modal: { paddingContentHorizontal: 24 },
          Segmented: { trackBg: '#eef2ed', itemSelectedBg: '#fff' },
          Menu: { itemSelectedBg: '#e8efe8', itemSelectedColor: '#426c52' },
          Rate: { starSize: 20 },
        },
      }}
    >
      <AntApp>
        <SyncShell>
          <Root />
        </SyncShell>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
