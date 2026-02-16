import React from 'react';
import TinaAdminApp from './TinaAdminApp.jsx';

class TinaErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown TinaCMS error' };
  }

  componentDidCatch(error) {
    console.error('TinaCMS failed to initialize:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', background: '#fff7ed' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>TinaCMS пока недоступен в локальном режиме</h2>
          <p style={{ margin: '0 0 10px', color: '#4b5563' }}>
            UI не инициализировался из-за конфигурации Tina Cloud. Это не ломает сайт.
          </p>
          <p style={{ margin: '0 0 6px', color: '#4b5563' }}><strong>Ошибка:</strong> {this.state.message}</p>
          <p style={{ margin: 0 }}>
            <a href="https://app.tina.io" target="_blank" rel="noreferrer" style={{ color: '#111', fontWeight: 600 }}>
              Открыть Tina Cloud
            </a>
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function SafeTinaAdmin() {
  return (
    <TinaErrorBoundary>
      <TinaAdminApp />
    </TinaErrorBoundary>
  );
}
