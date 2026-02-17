import React from 'react';
import TinaCMSProvider, { TinaAdmin } from 'tinacms';
import config from '../../tina/config';

export default function TinaAdminApp() {
  const schema = { ...config.schema, config };

  return (
    <TinaCMSProvider {...config} schema={schema}>
      <TinaAdmin config={config} />
    </TinaCMSProvider>
  );
}
