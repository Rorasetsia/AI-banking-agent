// Hosted entry: no dependency on the developer's computer or local credentials.
import { createApp } from '../server/server.mjs';

const publicOrigin = process.env.BANK_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (!publicOrigin) throw new Error('请配置BANK_PUBLIC_ORIGIN为部署后的精确HTTPS来源；Render可自动读取RENDER_EXTERNAL_URL。');
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT无效');
const app = createApp({ publicOrigin, dbPath: process.env.BANK_DB_PATH || 'data/hosted-preview.sqlite', modelRequired: true });
app.server.listen(port, '0.0.0.0', () => console.log(`Bank preview ready: ${publicOrigin}`));
const shutdown = () => app.close().finally(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
