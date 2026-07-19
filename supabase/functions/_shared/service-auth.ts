export function requireServiceRole(
  req: Request,
  serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
): Response | null {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const authorization = req.headers.get('Authorization') ?? '';
  if (!serviceKey || authorization !== `Bearer ${serviceKey}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return null;
}
