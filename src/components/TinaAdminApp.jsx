import React from 'react';
import { TinaAdmin, TinaCMSProvider2 } from 'tinacms';
import config from '../../tina/config';

export default function TinaAdminApp() {
  return (
    <TinaCMSProvider2 {...config}>
      <TinaAdmin config={config} />
    </TinaCMSProvider2>
  );
}
