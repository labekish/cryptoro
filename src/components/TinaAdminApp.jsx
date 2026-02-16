import React from 'react';
import TinaCMS, { TinaAdmin } from 'tinacms';
import config from '../../tina/config';

export default function TinaAdminApp() {
  const schema = { ...config?.schema, config };
  const cmsCallback = (cms) => {
    try {
      if (cms?.api?.tina) {
        cms.api.tina.isLocalClient = true;
        cms.api.tina.isSelfHosted = true;
      }
      cms?.flags?.set?.('tina-local-mode', true);
    } catch {
      // no-op
    }
  };

  return (
    <TinaCMS {...config} schema={schema} isLocalClient={true} cmsCallback={cmsCallback}>
      <TinaAdmin config={config} />
    </TinaCMS>
  );
}
