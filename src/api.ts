import { z } from 'zod'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import { normalizePerspectiveScore } from './perspective'

export type Intention = 'Dating'
export type ChildrenPreference = 'Want children' | 'Open to children' | 'Don\'t want children' | 'Not sure'
export type Gender = 'male' | 'female'
export type GenderPreference = Gender | 'both'
export type RunningTime = 'Morning' | 'Afternoon' | 'Evening'
export type RunningDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export interface RunningPreferences {
  easyPaceSecondsPerKm: number
  preferredDistanceKm: number
  preferredDays: RunningDay[]
  preferredTime: RunningTime
  runsPerWeek: number
}

export interface AccountUser {
  id: string
  email: string
  displayName: string
  birthDate: string
  intention: Intention
  childrenPreference: ChildrenPreference | null
  gender: Gender | null
  genderPreference: GenderPreference
  city: string | null
  neighborhood: string | null
  photoUrl: string | null
  faceLearningConsent: boolean
  runningPreferences: RunningPreferences
}

export interface ProfileUpdate {
  displayName: string
  intention: Intention
  childrenPreference?: ChildrenPreference | null
  gender: Gender
  genderPreference: GenderPreference
  city: string | null
  neighborhood: string | null
  runningPreferences: RunningPreferences
}

export interface SharedFingerprint {
  totalDistanceKm: number
  runCount: number
  medianDistanceKm: number
  medianPaceSecondsPerKm: number | null
  runsPerWeek: number
  preferredDays: RunningDay[]
}

export interface DiscoverableProfile extends SharedFingerprint {
  userId: string
  displayName: string
  isDemo: boolean
  intention: Intention
  childrenPreference: ChildrenPreference | null
  gender: Gender | null
  genderPreference: GenderPreference
  city: string | null
  neighborhood: string | null
  photoUrl: string | null
  hasFingerprint: boolean
  interests: RunnerInterest[]
  runningStyle: RunningStyle | null
  socialStyle: SocialStyle | null
  perspectiveAnswers: Record<string, number>
  personalLikeProbability: number
  reverseLikeProbability: number
  collaborativeProbability: number
}

export const runnerInterests = [
  'Social easy runs',
  '5K/10K training',
  'Trail running',
  'Speed workouts',
  'Long runs',
  'Race preparation',
  'Coffee after a run',
  'Exploring new routes',
] as const
export type RunnerInterest = (typeof runnerInterests)[number]

export const runningStyles = [
  'Easy and conversational',
  'Focused training',
  'A mix of both',
] as const
export type RunningStyle = (typeof runningStyles)[number]

export const socialStyles = [
  'One-on-one',
  'Small groups',
  'Either works',
] as const
export type SocialStyle = (typeof socialStyles)[number]

export interface SignupAnswers {
  interests: RunnerInterest[]
  runningStyle: RunningStyle
  socialStyle: SocialStyle
}

const profileSchema = z.object({
  display_name: z.string().min(1).max(60),
  birth_date: z.string(),
  intention: z.enum(['Dating']),
  children_preference: z.enum(['Want children', 'Open to children', "Don't want children", 'Not sure']).nullable(),
  gender: z.enum(['male', 'female']).nullable(),
  gender_preference: z.enum(['male', 'female', 'both']),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),
  photo_url: z.string().url().nullable(),
  face_learning_consent: z.boolean(),
  running_preferences: z.object({
    easy_pace_seconds_per_km: z.number(),
    preferred_distance_km: z.number(),
    preferred_days: z.array(
      z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
    ),
    preferred_time: z.enum(['Morning', 'Afternoon', 'Evening']),
    runs_per_week: z.number(),
  }),
})

const discoveryProfileSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().min(1).max(60),
  is_demo: z.boolean(),
  gender: z.enum(['male', 'female']).nullable(),
  gender_preference: z.enum(['male', 'female', 'both']),
  intention: z.enum(['Dating']),
  children_preference: z.enum(['Want children', 'Open to children', "Don't want children", 'Not sure']).nullable(),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),
  photo_url: z.string().url().nullable(),
  total_distance_km: z.coerce.number().positive().nullable(),
  run_count: z.number().int().positive().nullable(),
  median_distance_km: z.coerce.number().positive().nullable(),
  median_pace_seconds_per_km: z.number().int().positive().nullable(),
  runs_per_week: z.coerce.number().nonnegative().nullable(),
  preferred_days: z.array(
    z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  ).nullable(),
  interests: z.array(z.enum(runnerInterests)),
  running_style: z.enum(runningStyles).nullable(),
  social_style: z.enum(socialStyles).nullable(),
  perspective_answers: z.record(z.string(), z.number().min(-1).max(1)).nullable(),
})

export class SupabaseAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseAccountError'
  }
}

function throwOnError(error: { message: string } | null): void {
  if (error) {
    if (/already registered|already exists|user_already_exists/i.test(error.message)) {
      throw new SupabaseAccountError(
        'An account with this email already exists. Choose Sign in instead.',
      )
    }
    throw new SupabaseAccountError(error.message)
  }
}

async function loadAccountUser(
  userId: string,
  email: string,
): Promise<AccountUser> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('profiles')
    .select(
      'display_name,birth_date,intention,children_preference,gender,gender_preference,city,neighborhood,photo_url,face_learning_consent,running_preferences(easy_pace_seconds_per_km,preferred_distance_km,preferred_days,preferred_time,runs_per_week)',
    )
    .eq('user_id', userId)
    .single()

  throwOnError(error)
  const profile = profileSchema.safeParse(data)
  if (!profile.success) {
    throw new SupabaseAccountError(
      'Your account profile is missing or has an invalid shape. Reapply the Supabase database migration and try again.',
    )
  }

  return {
    id: userId,
    email,
    displayName: profile.data.display_name,
    birthDate: profile.data.birth_date,
    intention: 'Dating' as const,
    childrenPreference: profile.data.children_preference,
    gender: profile.data.gender,
    genderPreference: profile.data.gender_preference,
    city: profile.data.city,
    neighborhood: profile.data.neighborhood,
    photoUrl: profile.data.photo_url,
    faceLearningConsent: profile.data.face_learning_consent,
    runningPreferences: {
      easyPaceSecondsPerKm:
        profile.data.running_preferences.easy_pace_seconds_per_km,
      preferredDistanceKm:
        profile.data.running_preferences.preferred_distance_km,
      preferredDays: profile.data.running_preferences.preferred_days,
      preferredTime: profile.data.running_preferences.preferred_time,
      runsPerWeek: profile.data.running_preferences.runs_per_week,
    },
  }
}

export async function getCurrentUser(): Promise<AccountUser | null> {
  const client = requireSupabase()
  const { data, error } = await client.auth.getUser()
  if (error) {
    if (error.name === 'AuthSessionMissingError') {
      return null
    }
    throw new SupabaseAccountError(error.message)
  }

  if (!data.user) {
    return null
  }

  return loadAccountUser(data.user.id, data.user.email ?? '')
}

export async function checkSignupEmailAvailability(email: string): Promise<boolean> {
  const normalizedEmail = z.string().email().max(320).safeParse(email.trim().toLowerCase())
  if (!normalizedEmail.success) {
    throw new SupabaseAccountError('Enter a valid email address.')
  }

  const { data, error } = await requireSupabase().functions.invoke(
    'email-available',
    { body: { email: normalizedEmail.data } },
  )
  if (error?.message === 'Failed to send a request to the Edge Function') {
    throw new SupabaseAccountError(
      'Could not reach the email-available Edge Function. Confirm it is deployed to the same Supabase project as this app, that its slug is exactly "email-available", and that Verify JWT is disabled.',
    )
  }
  if (error) {
    console.error('Email availability Edge Function failed', error)
    if (error.context instanceof Response) {
      try {
        const errorBody: unknown = await error.context.clone().json()
        const parsedError = z.object({ error: z.string() }).safeParse(errorBody)
        if (parsedError.success) {
          throw new SupabaseAccountError(parsedError.data.error)
        }
      } catch (responseError) {
        if (responseError instanceof SupabaseAccountError) throw responseError
      }
    }
  }
  throwOnError(error)

  const result = z.object({ available: z.boolean() }).safeParse(data)
  if (!result.success) {
    throw new SupabaseAccountError('The email availability response was invalid.')
  }
  return result.data.available
}

export async function registerAccount(input: {
  email: string
  password: string
  displayName: string
  birthDate: string
  intention: Intention
  childrenPreference?: ChildrenPreference
  gender: Gender
  genderPreference: GenderPreference
  perspectiveAnswers: Record<string, number>
}): Promise<{ user: AccountUser | null; confirmationRequired: boolean }> {
  const client = requireSupabase()
  const parsedAnswers = z.record(
    z.string(),
    z.number().min(-1).max(1),
  ).safeParse(input.perspectiveAnswers)
  if (!parsedAnswers.success) {
    throw new SupabaseAccountError('Perspective scores must be between -1 and 1.')
  }

  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/?confirmed=1`,
      data: {
        display_name: input.displayName,
        birth_date: input.birthDate,
        intention: input.intention,
        ...(input.childrenPreference
          ? { children_preference: input.childrenPreference }
          : {}),
        gender: input.gender,
        gender_preference: input.genderPreference,
        discovery_perspective_answers: Object.fromEntries(
          Object.entries(parsedAnswers.data).map(([questionId, score]) => [
            questionId,
            normalizePerspectiveScore(score),
          ]),
        ),
      },
    },
  })

  throwOnError(error)
  if (data.user?.identities?.length === 0) {
    throw new SupabaseAccountError(
      'An account with this email already exists. Choose Sign in instead.',
    )
  }
  if (!data.session || !data.user) {
    return { user: null, confirmationRequired: true }
  }

  await savePerspectiveAnswers(
    Object.fromEntries(
      Object.entries(parsedAnswers.data).map(([questionId, score]) => [
        questionId,
        normalizePerspectiveScore(score),
      ]),
    ),
  )
  return {
    user: await loadAccountUser(data.user.id, data.user.email ?? input.email),
    confirmationRequired: false,
  }
}

export async function loginAccount(input: {
  email: string
  password: string
}): Promise<AccountUser> {
  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword(input)
  throwOnError(error)
  if (!data.user) {
    throw new SupabaseAccountError('Supabase did not return a signed-in user.')
  }
  const answersResult = z.record(
    z.string(),
    z.number().min(-1).max(1),
  ).safeParse(data.user.user_metadata.discovery_perspective_answers ?? {})
  if (answersResult.success && Object.keys(answersResult.data).length > 0) {
    await savePerspectiveAnswers(answersResult.data)
  }
  return loadAccountUser(data.user.id, data.user.email ?? input.email)
}

export async function updateAccountProfile(
  input: ProfileUpdate,
): Promise<AccountUser> {
  const client = requireSupabase()
  const { data, error } = await client.auth.getUser()
  throwOnError(error)
  if (!data.user) {
    throw new SupabaseAccountError('Sign in again before updating your profile.')
  }

  const { error: updateError } = await client.rpc('update_my_profile', {
    p_profile: {
      display_name: input.displayName,
      intention: input.intention,
      children_preference: input.childrenPreference,
      gender: input.gender,
      gender_preference: input.genderPreference,
      city: input.city,
      neighborhood: input.neighborhood,
    },
    p_preferences: {
      easy_pace_seconds_per_km:
        input.runningPreferences.easyPaceSecondsPerKm,
      preferred_distance_km: input.runningPreferences.preferredDistanceKm,
      preferred_days: input.runningPreferences.preferredDays,
      preferred_time: input.runningPreferences.preferredTime,
      runs_per_week: input.runningPreferences.runsPerWeek,
    },
  })
  throwOnError(updateError)

  return loadAccountUser(data.user.id, data.user.email ?? '')
}

export async function getDiscoverableProfiles(): Promise<DiscoverableProfile[]> {
  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  throwOnError(userError)
  if (!userData.user) {
    throw new SupabaseAccountError('Sign in to browse dating profiles.')
  }

  const { data, error } = await client
    .from('runner_discovery')
    .select(
      'user_id,display_name,is_demo,gender,gender_preference,intention,children_preference,city,neighborhood,photo_url,total_distance_km,run_count,median_distance_km,median_pace_seconds_per_km,runs_per_week,preferred_days,interests,running_style,social_style,perspective_answers',
    )
    .order('created_at', { ascending: false })

  throwOnError(error)
  const profiles = z.array(discoveryProfileSchema).safeParse(data)
  if (!profiles.success) {
    throw new SupabaseAccountError(
      'Discovery profiles have an invalid shape. Apply the perspective matching and dating-only Supabase migrations and try again.',
    )
  }

  const { data: swipesData, error: swipesError } = await client
    .from('profile_swipes')
    .select('target_user_id')
    .eq('swiper_id', userData.user.id)
  throwOnError(swipesError)
  const swipes = z.array(z.object({ target_user_id: z.string().uuid() })).safeParse(swipesData)
  if (!swipes.success) {
    throw new SupabaseAccountError('Saved swipe history has an invalid shape.')
  }
  const swipedProfileIds = new Set(swipes.data.map((swipe) => swipe.target_user_id))

  const { data: recommendationData, error: recommendationError } = await client
    .rpc('get_my_recommendation_scores')
  throwOnError(recommendationError)
  const recommendationScores = z.array(z.object({
    candidate_id: z.string().uuid(),
    personal_score: z.number().min(0).max(1),
    reverse_score: z.number().min(0).max(1),
    collaborative_score: z.number().min(0).max(1),
  })).safeParse(recommendationData)
  if (!recommendationScores.success) {
    throw new SupabaseAccountError('Recommendation scores have an invalid shape. Apply the face recommendation migration and try again.')
  }
  const recommendationByCandidate = new Map(
    recommendationScores.data.map((score) => [score.candidate_id, score]),
  )

  return profiles.data.map((profile) => {
    const hasFingerprint = profile.run_count !== null
    return {
      userId: profile.user_id,
      displayName: profile.display_name,
      isDemo: profile.is_demo,
      intention: 'Dating' as const,
      childrenPreference: profile.children_preference,
      gender: profile.gender,
      genderPreference: profile.gender_preference,
      city: profile.city,
      neighborhood: profile.neighborhood,
      photoUrl: profile.photo_url,
      totalDistanceKm: profile.total_distance_km ?? 0,
      runCount: profile.run_count ?? 0,
      medianDistanceKm: profile.median_distance_km ?? 0,
      medianPaceSecondsPerKm: profile.median_pace_seconds_per_km,
      runsPerWeek: profile.runs_per_week ?? 0,
      preferredDays: profile.preferred_days ?? [],
      hasFingerprint,
      interests: profile.interests,
      runningStyle: profile.running_style,
      socialStyle: profile.social_style,
      perspectiveAnswers: Object.fromEntries(
        Object.entries(profile.perspective_answers ?? {}).map(([questionId, score]) => [
          questionId,
          normalizePerspectiveScore(score),
        ]),
      ),
      personalLikeProbability: recommendationByCandidate.get(profile.user_id)?.personal_score ?? 0.5,
      reverseLikeProbability: recommendationByCandidate.get(profile.user_id)?.reverse_score ?? 0.5,
      collaborativeProbability: recommendationByCandidate.get(profile.user_id)?.collaborative_score ?? 0.5,
    }
  }).filter((profile) =>
    profile.userId === userData.user.id || !swipedProfileIds.has(profile.userId),
  )
}

export function matchesGenderPreference(
  candidateGender: Gender | null,
  preference: GenderPreference,
): boolean {
  return candidateGender !== null
    && (preference === 'both' || candidateGender === preference)
}

export async function setMyFaceLearningConsent(enabled: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('set_my_face_learning_consent', {
    p_enabled: enabled,
  })
  throwOnError(error)
}

export async function uploadMyProfilePhoto(file: File): Promise<string> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size === 0 ||
    file.size > 5 * 1024 * 1024
  ) {
    throw new SupabaseAccountError('Choose a JPG, PNG, or WebP image up to 5 MB.')
  }

  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  throwOnError(userError)
  if (!userData.user) {
    throw new SupabaseAccountError('Sign in before uploading a profile photo.')
  }

  const photoId = crypto.randomUUID()
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const storagePath = `${userData.user.id}/${photoId}.${extension}`
  const { error: uploadError } = await client.storage
    .from('profile-photos')
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: true,
    })
  throwOnError(uploadError)

  const { data: publicUrl } = client.storage
    .from('profile-photos')
    .getPublicUrl(storagePath)
  const photoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`
  const { data: updatedProfile, error: updateError } = await client
    .from('profiles')
    .update({ photo_url: photoUrl })
    .eq('user_id', userData.user.id)
    .select('user_id')
    .single()
  throwOnError(updateError)
  if (!updatedProfile) {
    throw new SupabaseAccountError('Your profile photo could not be attached to your profile.')
  }

  const { data: profileData, error: profileError } = await client
    .from('profiles')
    .select('face_learning_consent')
    .eq('user_id', userData.user.id)
    .single()
  throwOnError(profileError)
  const inferenceUrl = import.meta.env.VITE_FACE_FEATURE_SERVICE_URL?.trim()
  if (profileData?.face_learning_consent && inferenceUrl) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession()
    throwOnError(sessionError)
    const accessToken = sessionData.session?.access_token
    if (!accessToken) {
      throw new SupabaseAccountError('Sign in again before processing your photo.')
    }
    const response = await fetch(`${inferenceUrl.replace(/\/$/, '')}/v1/photos/index`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photo_id: photoId, storage_path: storagePath, mime_type: file.type }),
    })
    if (!response.ok) {
      throw new SupabaseAccountError('Photo uploaded, but private face features could not be processed. Check the inference service.')
    }
  }
  return photoUrl
}

export async function recordProfileSwipe(
  targetUserId: string,
  liked: boolean,
): Promise<{ matched: boolean; matchedUserId: string | null }> {
  const parsedTarget = z.string().uuid().safeParse(targetUserId)
  if (!parsedTarget.success) {
    throw new SupabaseAccountError('Choose a valid dating profile.')
  }
  const { data, error } = await requireSupabase().rpc('record_profile_swipe', {
    p_target_user_id: parsedTarget.data,
    p_liked: liked,
  })
  throwOnError(error)
  const result = z.array(z.object({
    matched: z.boolean(),
    matched_user_id: z.string().uuid().nullable(),
  })).safeParse(data)
  if (!result.success || !result.data[0]) {
    throw new SupabaseAccountError('The swipe response was invalid.')
  }
  return {
    matched: result.data[0].matched,
    matchedUserId: result.data[0].matched_user_id,
  }
}

export interface ProfileNotification {
  id: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export interface ChatConversation {
  id: string
  matchId: string
  otherUserId: string
  otherDisplayName: string
  otherPhotoUrl: string | null
  lastMessageContent: string | null
  lastMessageAt: string | null
  unreadCount: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  readAt: string | null
}

const chatMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  content: z.string().min(1).max(4000),
  created_at: z.string(),
  read_at: z.string().nullable(),
})

function mapChatMessage(message: z.infer<typeof chatMessageSchema>): ChatMessage {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    content: message.content,
    createdAt: message.created_at,
    readAt: message.read_at,
  }
}

export async function getMyConversations(): Promise<ChatConversation[]> {
  const { data, error } = await requireSupabase().rpc('get_my_conversations')
  throwOnError(error)
  const conversations = z.array(z.object({
    conversation_id: z.string().uuid(),
    match_id: z.string().uuid(),
    other_user_id: z.string().uuid(),
    other_display_name: z.string().min(1),
    other_photo_url: z.string().url().nullable(),
    last_message_content: z.string().nullable(),
    last_message_at: z.string().nullable(),
    unread_count: z.coerce.number().int().nonnegative(),
  })).safeParse(data)
  if (!conversations.success) {
    throw new SupabaseAccountError('Conversations have an invalid shape.')
  }
  return conversations.data.map((conversation) => ({
    id: conversation.conversation_id,
    matchId: conversation.match_id,
    otherUserId: conversation.other_user_id,
    otherDisplayName: conversation.other_display_name,
    otherPhotoUrl: conversation.other_photo_url,
    lastMessageContent: conversation.last_message_content,
    lastMessageAt: conversation.last_message_at,
    unreadCount: conversation.unread_count,
  }))
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const parsedId = z.string().uuid().safeParse(conversationId)
  if (!parsedId.success) {
    throw new SupabaseAccountError('Choose a valid conversation.')
  }
  const { data, error } = await requireSupabase()
    .from('messages')
    .select('id,conversation_id,sender_id,content,created_at,read_at')
    .eq('conversation_id', parsedId.data)
    .order('created_at', { ascending: true })
    .limit(200)
  throwOnError(error)
  const messages = z.array(chatMessageSchema).safeParse(data)
  if (!messages.success) {
    throw new SupabaseAccountError('Conversation messages have an invalid shape.')
  }
  return messages.data.map(mapChatMessage)
}

export async function sendMyMessage(
  conversationId: string,
  content: string,
): Promise<ChatMessage> {
  const parsedId = z.string().uuid().safeParse(conversationId)
  const trimmedContent = content.trim()
  if (!parsedId.success || trimmedContent.length < 1 || trimmedContent.length > 4000) {
    throw new SupabaseAccountError('Enter a message between 1 and 4000 characters.')
  }
  const { data, error } = await requireSupabase().rpc('send_my_message', {
    p_conversation_id: parsedId.data,
    p_content: trimmedContent,
  })
  throwOnError(error)
  const messages = z.array(chatMessageSchema).safeParse(data)
  if (!messages.success || !messages.data[0]) {
    throw new SupabaseAccountError('The sent message response was invalid.')
  }
  return mapChatMessage(messages.data[0])
}

export async function markMyConversationRead(conversationId: string): Promise<void> {
  const parsedId = z.string().uuid().safeParse(conversationId)
  if (!parsedId.success) {
    throw new SupabaseAccountError('Choose a valid conversation.')
  }
  const { error } = await requireSupabase().rpc('mark_my_conversation_read', {
    p_conversation_id: parsedId.data,
  })
  throwOnError(error)
}

export function subscribeToConversationMessages(
  conversationId: string,
  onMessage: (message: ChatMessage) => void,
  onError: (message: string) => void,
): RealtimeChannel {
  const parsedId = z.string().uuid().safeParse(conversationId)
  if (!parsedId.success) {
    throw new SupabaseAccountError('Choose a valid conversation.')
  }
  return requireSupabase()
    .channel(`conversation:${parsedId.data}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${parsedId.data}`,
      },
      (payload) => {
        const message = chatMessageSchema.safeParse(payload.new)
        if (!message.success) {
          onError('A realtime message had an invalid shape.')
          return
        }
        onMessage(mapChatMessage(message.data))
      },
    )
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError(error?.message ?? 'Could not connect to realtime messaging.')
      }
    })
}

const notificationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  read_at: z.string().nullable(),
  created_at: z.string(),
})

export async function getMyNotifications(): Promise<ProfileNotification[]> {
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('id,title,body,read_at,created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  throwOnError(error)
  const notifications = z.array(notificationSchema).safeParse(data)
  if (!notifications.success) {
    throw new SupabaseAccountError('Notifications have an invalid shape.')
  }
  return notifications.data.map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    readAt: notification.read_at,
    createdAt: notification.created_at,
  }))
}

export async function markMyNotificationsRead(): Promise<void> {
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  throwOnError(error)
}

export async function saveMyRunningFingerprint(
  fingerprint: SharedFingerprint,
): Promise<void> {
  const { error } = await requireSupabase().rpc('save_my_running_fingerprint', {
    p_total_distance_km: fingerprint.totalDistanceKm,
    p_run_count: fingerprint.runCount,
    p_median_distance_km: fingerprint.medianDistanceKm,
    p_median_pace_seconds_per_km:
      fingerprint.medianPaceSecondsPerKm === null
        ? null
        : Math.round(fingerprint.medianPaceSecondsPerKm),
    p_runs_per_week: fingerprint.runsPerWeek,
    p_preferred_days: fingerprint.preferredDays,
  })
  throwOnError(error)
}

async function savePerspectiveAnswers(
  answers: Record<string, number>,
): Promise<void> {
  for (const [questionId, score] of Object.entries(answers)) {
    await saveMyPerspectiveAnswer(questionId, score)
  }
}

export async function saveMyPerspectiveAnswer(
  questionId: string,
  score: number,
): Promise<void> {
  if (!questionId || !Number.isFinite(score) || score < -1 || score > 1) {
    throw new SupabaseAccountError('Choose a valid perspective answer.')
  }
  const { error } = await requireSupabase().rpc('save_my_perspective_answer', {
    p_question_id: questionId,
    p_score: normalizePerspectiveScore(score),
  })
  throwOnError(error)
}

export async function clearMyRunningFingerprint(): Promise<void> {
  const { error } = await requireSupabase().rpc('clear_my_running_fingerprint')
  throwOnError(error)
}

export async function logoutAccount(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut()
  throwOnError(error)
}

export async function deleteAccount(): Promise<void> {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('delete-account', {
    body: {},
  })
  throwOnError(error)
  if (!data?.ok) {
    throw new SupabaseAccountError(
      'Account deletion did not complete. Deploy the delete-account Supabase Edge Function and try again.',
    )
  }
  const { error: signOutError } = await client.auth.signOut({ scope: 'local' })
  throwOnError(signOutError)
}
