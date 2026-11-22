// @vitest-environment jsdom

import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkSignupEmailAvailability,
  getDiscoverableProfiles,
  sendMyMessage,
  matchesGenderPreference,
  recordProfileSwipe,
  registerAccount,
  saveMyPerspectiveAnswer,
  saveMyRunningFingerprint,
  uploadMyProfilePhoto,
} from './api'
import { requireSupabase } from './supabase'

vi.mock('./supabase', () => ({
  requireSupabase: vi.fn(),
}))

const client = createClient(
  'https://example.supabase.co',
  'test-publishable-key',
  { auth: { persistSession: false } },
)

beforeEach(() => {
  vi.mocked(requireSupabase).mockReturnValue(client)
})

describe('registerAccount', () => {
  it('checks a normalized email through the server-side availability function', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { available: true },
      error: null,
    })
    vi.mocked(requireSupabase).mockReturnValue({
      functions: { invoke },
    } as never)

    await expect(checkSignupEmailAvailability(' Person@Example.com ')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('email-available', {
      body: { email: 'person@example.com' },
    })
  })

  it('explains likely endpoint-name and CORS causes for Edge Function fetch errors', async () => {
    vi.mocked(requireSupabase).mockReturnValue({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Failed to send a request to the Edge Function' },
        }),
      },
    } as never)

    await expect(checkSignupEmailAvailability('person@example.com')).rejects.toThrow(
      'Confirm it is deployed to the same Supabase project',
    )
  })

  it('shows a configuration message returned by the Edge Function', async () => {
    vi.mocked(requireSupabase).mockReturnValue({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(
              JSON.stringify({ error: 'Email availability is not configured. Check the function secrets.' }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
          },
        }),
      },
    } as never)

    await expect(checkSignupEmailAvailability('person@example.com')).rejects.toThrow(
      'Email availability is not configured. Check the function secrets.',
    )
  })

  it('reports an email already in use', async () => {
    vi.mocked(requireSupabase).mockReturnValue({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: { available: false },
          error: null,
        }),
      },
    } as never)

    await expect(checkSignupEmailAvailability('person@example.com')).resolves.toBe(false)
  })

  it('rejects invalid emails without calling the availability function', async () => {
    const invoke = vi.fn()
    vi.mocked(requireSupabase).mockReturnValue({
      functions: { invoke },
    } as never)

    await expect(checkSignupEmailAvailability('not-an-email')).rejects.toThrow(
      'Enter a valid email address.',
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports email confirmation when signup returns no session', async () => {
    const signUp = vi.spyOn(client.auth, 'signUp').mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    })

    await expect(
      registerAccount({
        email: 'person@example.com',
        password: 'a-secure-test-password',
        displayName: 'Person',
        birthDate: '1990-01-01',
        intention: 'Dating',
        childrenPreference: 'Open to children',
        gender: 'female',
        genderPreference: 'male',
        perspectiveAnswers: {
          'people-rational': -0.5,
          'religion-society': 0.75,
        },
      }),
    ).resolves.toEqual({ user: null, confirmationRequired: true })

    expect(signUp).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'a-secure-test-password',
      options: {
        emailRedirectTo: 'http://localhost:3000/?confirmed=1',
        data: {
          display_name: 'Person',
          birth_date: '1990-01-01',
          intention: 'Dating',
          children_preference: 'Open to children',
          gender: 'female',
          gender_preference: 'male',
          discovery_perspective_answers: {
            'people-rational': -0.5,
            'religion-society': 1,
          },
        },
      },
    })

  })

  it('allows signup without answering perspective questions', async () => {
    const signUp = vi.spyOn(client.auth, 'signUp').mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    })

    await expect(
      registerAccount({
        email: 'person@example.com',
        password: 'a-secure-test-password',
        displayName: 'Person',
        birthDate: '1990-01-01',
        intention: 'Dating',
        gender: 'male',
        genderPreference: 'both',
        perspectiveAnswers: {},
      }),
    ).resolves.toEqual({ user: null, confirmationRequired: true })

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: expect.objectContaining({
          gender: 'male',
          gender_preference: 'both',
          discovery_perspective_answers: {},
        }),
      }),
    }))
  })

  it('rejects Supabase duplicate-email signup responses', async () => {
    vi.spyOn(client.auth, 'signUp').mockResolvedValue({
      data: {
        user: { identities: [] } as never,
        session: null,
      },
      error: null,
    })

    await expect(
      registerAccount({
        email: 'person@example.com',
        password: 'a-secure-test-password',
        displayName: 'Person',
        birthDate: '1990-01-01',
        intention: 'Dating',
        gender: 'female',
        genderPreference: 'female',
        perspectiveAnswers: {},
      }),
    ).rejects.toThrow('An account with this email already exists.')
  })
})

describe('dating discovery', () => {
  it('filters candidate profiles according to the selected gender preference', () => {
    expect(matchesGenderPreference('female', 'female')).toBe(true)
    expect(matchesGenderPreference('male', 'female')).toBe(false)
    expect(matchesGenderPreference('male', 'both')).toBe(true)
    expect(matchesGenderPreference(null, 'both')).toBe(false)
  })

  it('rejects unsupported profile photo files before upload', async () => {
    const file = new File(['not an image'], 'profile.gif', { type: 'image/gif' })
    await expect(uploadMyProfilePhoto(file)).rejects.toThrow(
      'Choose a JPG, PNG, or WebP image up to 5 MB.',
    )
  })

  it('records a swipe and returns mutual-match state', async () => {
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({
      data: [{
        matched: true,
        matched_user_id: '00000000-0000-4000-8000-000000000002',
      }],
      error: null,
    } as never)

    await expect(
      recordProfileSwipe('00000000-0000-4000-8000-000000000002', true),
    ).resolves.toEqual({
      matched: true,
      matchedUserId: '00000000-0000-4000-8000-000000000002',
    })
    expect(rpc).toHaveBeenCalledWith('record_profile_swipe', {
      p_target_user_id: '00000000-0000-4000-8000-000000000002',
      p_liked: true,
    })
  })

  it('sends a trimmed message through the authenticated conversation RPC', async () => {
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({
      data: [{
        id: '00000000-0000-4000-8000-000000000003',
        conversation_id: '00000000-0000-4000-8000-000000000004',
        sender_id: '00000000-0000-4000-8000-000000000001',
        content: 'Hello there',
        created_at: '2026-11-22T10:00:00.000Z',
        read_at: null,
      }],
      error: null,
    } as never)

    await expect(
      sendMyMessage(
        '00000000-0000-4000-8000-000000000004',
        '  Hello there  ',
      ),
    ).resolves.toMatchObject({
      conversationId: '00000000-0000-4000-8000-000000000004',
      content: 'Hello there',
    })
    expect(rpc).toHaveBeenCalledWith('send_my_message', {
      p_conversation_id: '00000000-0000-4000-8000-000000000004',
      p_content: 'Hello there',
    })
  })

  it('rejects empty messages before calling Supabase', async () => {
    const rpc = vi.spyOn(client, 'rpc')
    rpc.mockClear()
    await expect(
      sendMyMessage(
        '00000000-0000-4000-8000-000000000004',
        '   ',
      ),
    ).rejects.toThrow('Enter a message between 1 and 4000 characters.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('saves only aggregate fingerprint fields through the authenticated RPC', async () => {
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({
      data: null,
      error: null,
    } as never)

    await saveMyRunningFingerprint({
      totalDistanceKm: 24.5,
      runCount: 6,
      medianDistanceKm: 4.1,
      medianPaceSecondsPerKm: 345.6,
      runsPerWeek: 3,
      preferredDays: ['Tue', 'Sat'],
    })

    expect(rpc).toHaveBeenCalledWith('save_my_running_fingerprint', {
      p_total_distance_km: 24.5,
      p_run_count: 6,
      p_median_distance_km: 4.1,
      p_median_pace_seconds_per_km: 346,
      p_runs_per_week: 3,
      p_preferred_days: ['Tue', 'Sat'],
    })
  })

  it('saves perspective answers on one of five normalized points', async () => {
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({
      data: null,
      error: null,
    } as never)

    await saveMyPerspectiveAnswer('people-rational', 0.74)

    expect(rpc).toHaveBeenCalledWith('save_my_perspective_answer', {
      p_question_id: 'people-rational',
      p_score: 0.5,
    })
  })

  it('does not silently accept errors while loading discovery profiles', async () => {
    vi.spyOn(client.auth, 'getUser').mockResolvedValue({
      data: { user: { id: '00000000-0000-4000-8000-000000000001' } } as never,
      error: null,
    })
    const query = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Migration required' },
      }),
    }
    vi.spyOn(client, 'from').mockReturnValue(query as never)

    await expect(getDiscoverableProfiles()).rejects.toThrow('Migration required')
  })
})
