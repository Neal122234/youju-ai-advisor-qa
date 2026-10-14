// 未匹配的 /api/* → 404 JSON
import { errorJson } from '../_lib/http';
export const onRequest: PagesFunction = async ({ request }) => errorJson(404, 'NOT_FOUND', `接口不存在：${new URL(request.url).pathname}`);
