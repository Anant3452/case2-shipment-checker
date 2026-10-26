// Starts the server. PORT defaults to 3000; the host sets PORT for deployment.

import { createApp } from './app';

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Shipment checker listening on port ${port}`);
});
