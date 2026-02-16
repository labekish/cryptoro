import React from 'react';
import TinaCMS from 'tinacms';
import config from '../../tina/config';

export default function TinaProviderApp({ children }) {
  const schema = { ...config?.schema, config };

  return (
    <TinaCMS {...config} schema={schema}>
      {children}
    </TinaCMS>
  );
}
