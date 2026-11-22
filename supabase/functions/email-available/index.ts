import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS')
const hmacSecret = Deno.env.get('EMAIL_CHECK_HMAC_SECRET')

function getDefaultSecretKey(): string | undefined {
  if (!secretKeysJson) return undefined
  try {
    const secretKeys: unknown = JSON.parse(secretKeysJson)
    if (typeof secretKeys !== 'object' || secretKeys === null) return undefined
    const defaultKey = (secretKeys as Record<string, unknown>).default
    return typeof defaultKey === 'string' && defaultKey.length > 0
      ? defaultKey
      : undefined
  } catch {
    return undefined
  }
}

const secretKey = getDefaultSecretKey()

async function hashClientAddress(address: string): Promise<string> {
  if (!hmacSecret) {
    throw new Error('EMAIL_CHECK_HMAC_SECRET is not configured.')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hmacSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(address),
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? '*'

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: corsHeaders },
    )
  }

  if (!supabaseUrl || !secretKey || !hmacSecret || hmacSecret.length < 32) {
    console.error(
      'Email availability function requires SUPABASE_URL, a default key in SUPABASE_SECRET_KEYS, and a 32-character EMAIL_CHECK_HMAC_SECRET.',
    )
    return Response.json(
      { error: 'Email availability is not configured. Check the function secrets.' },
      { status: 500, headers: corsHeaders },
    )
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  })

  let email: unknown
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || !('email' in body)) {
      return Response.json(
        { error: 'Enter a valid email address.' },
        { status: 400, headers: corsHeaders },
      )
    }
    email = body.email
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400, headers: corsHeaders },
    )
  }

  if (
    typeof email !== 'string' ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return Response.json(
      { error: 'Enter a valid email address.' },
      { status: 400, headers: corsHeaders },
    )
  }

  const clientAddress =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()

  if (!clientAddress) {
    return Response.json(
      { error: 'Could not verify the request source. Try again later.' },
      { status: 400, headers: corsHeaders },
    )
  }

  const { data, error } = await adminClient.rpc(
    'check_signup_email_availability',
    {
      p_email: email.trim().toLowerCase(),
      p_client_hash: await hashClientAddress(clientAddress),
    },
  )

  if (error) {
    console.error('Email availability check failed', error.message)
    return Response.json(
      { error: 'Could not check this email right now. Try again later.' },
      { status: 500, headers: corsHeaders },
    )
  }

  const result = Array.isArray(data) ? data[0] : null
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof result.is_available !== 'boolean'
  ) {
    console.error('Email availability RPC returned an invalid response')
    return Response.json(
      { error: 'Could not check this email right now. Try again later.' },
      { status: 500, headers: corsHeaders },
    )
  }

  if (typeof result.retry_after_seconds === 'number') {
    return Response.json(
      { error: 'Too many email checks. Try again later.' },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(result.retry_after_seconds),
        },
      },
    )
  }

  return Response.json(
    { available: result.is_available },
    { headers: corsHeaders },
  )
})
