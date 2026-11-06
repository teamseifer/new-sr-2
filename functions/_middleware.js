import { onRequest as apiProxy } from './api_proxy.js';

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (path === '/api_proxy.php' || path === '/api_proxy') {
    return apiProxy(context);
  }
  return context.next();
}
