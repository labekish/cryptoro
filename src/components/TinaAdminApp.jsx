import React from 'react';
import { TinaAdmin } from 'tinacms';
import config from '../../tina/config';

export default function TinaAdminApp() {
  return <TinaAdmin config={config} />;
}
