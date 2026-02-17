import React from 'react';
import TinaCMS, { TinaAdmin } from 'tinacms';
import config from '../../tina/config';

export default function TinaAdminApp() {
  const schema = { ...config.schema, config };

  return (
    <TinaCMS {...config} schema={schema}>
      <TinaAdmin config={config} />
    </TinaCMS>
  );
}
