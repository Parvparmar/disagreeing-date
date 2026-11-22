import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const allowedOrigins = (Deno.env.get('APP_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (!supabaseUrl || !anonKey || !serviceRoleKey || allowedOrigins.length === 0) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and APP_ORIGINS are required.',
  )
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  if (!allowedOrigins.includes(origin)) {
    return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 })
  }

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

  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json(
      { error: 'Sign in to delete your account.' },
      { status: 401, headers: corsHeaders },
    )
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()

  if (userError || !userData.user) {
    return Response.json(
      { error: 'Your session is invalid. Sign in again.' },
      { status: 401, headers: corsHeaders },
    )
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { error: deletionError } = await adminClient.auth.admin.deleteUser(
    userData.user.id,
  )

  if (deletionError) {
    console.error('Supabase account deletion failed', deletionError.message)
    return Response.json(
      { error: 'Account deletion failed. Please try again later.' },
      { status: 500, headers: corsHeaders },
    )
  }

  return Response.json({ ok: true }, { headers: corsHeaders })
})
