// 未匹配的 /api/*：路径存在但方法不对 → 405（Pages 对缺少方法 handler 的路由会落到这里），否则 404
import { errorJson } from '../_lib/http';

const ROUTES: [RegExp, string[]][] = [
  [/^\/api\/health$/, ['GET']], [/^\/api\/chat$/, ['POST']], [/^\/api\/feedback$/, ['POST']],
  [/^\/api\/logs$/, ['GET']], [/^\/api\/logs\/[^/]+$/, ['GET']], [/^\/api\/dashboard$/, ['GET']],
  [/^\/api\/gaps$/, ['GET']], [/^\/api\/gaps\/[^/]+$/, ['POST']], [/^\/api\/gaps\/[^/]+\/verify$/, ['POST']],
  [/^\/api\/alerts$/, ['GET']], [/^\/api\/alerts\/[^/]+\/ack$/, ['POST']],
  [/^\/api\/tickets$/, ['GET']], [/^\/api\/tickets\/[^/]+$/, ['POST']],
  [/^\/api\/kb\/docs$/, ['GET', 'POST']], [/^\/api\/kb\/docs\/[^/]+$/, ['GET']], [/^\/api\/kb\/publish$/, ['POST']],
  [/^\/api\/kb\/rollback$/, ['POST']], [/^\/api\/kb\/unpublish$/, ['POST']], [/^\/api\/kb\/releases$/, ['GET']], [/^\/api\/kb\/preview-chunks$/, ['POST']],
  [/^\/api\/eval\/run$/, ['POST']], [/^\/api\/admin\/seed$/, ['POST']],
];

export const onRequest: PagesFunction = async ({ request }) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const hit = ROUTES.find(([re]) => re.test(path));
  if (hit && !hit[1].includes(request.method)) {
    return errorJson(405, 'METHOD_NOT_ALLOWED', `${path} 不支持 ${request.method}，请使用 ${hit[1].join('/')}`, { allow: hit[1].join(', ') });
  }
  return errorJson(404, 'NOT_FOUND', `接口不存在：${path}`);
};
