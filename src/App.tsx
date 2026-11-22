import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SupabaseAccountError,
  checkSignupEmailAvailability,
  deleteAccount as deleteAccountRequest,
  getConversationMessages,
  getMyConversations,
  getDiscoverableProfiles,
  getCurrentUser,
  getMyNotifications,
  loginAccount,
  logoutAccount,
  markMyConversationRead,
  markMyNotificationsRead,
  matchesGenderPreference,
  recordProfileSwipe,
  registerAccount,
  saveMyPerspectiveAnswer,
  setMyFaceLearningConsent,
  sendMyMessage,
  subscribeToConversationMessages,
  uploadMyProfilePhoto,
  updateAccountProfile,
  type AccountUser,
  type ChatConversation,
  type ChatMessage,
  type ChildrenPreference,
  type DiscoverableProfile,
  type Gender,
  type GenderPreference,
  type ProfileNotification,
} from './api'
import {
  normalizePerspectiveScore,
  onboardingPerspectiveQuestions,
  perspectiveQuestions,
} from './perspective'
import { isSupabaseConfigured, requireSupabase } from './supabase'
import './App.css'

type Page = 'discover' | 'swipe' | 'messages' | 'profile'

interface CandidateProfile {
  id: string
  displayName: string
  isDemo: boolean
  gender: Gender | null
  neighborhood: string
  childrenPreference: ChildrenPreference | null
  personality: string
  bio: string
  photoUrl?: string
  perspectiveAnswers: Record<string, number>
  personalLikeProbability: number
  reverseLikeProbability: number
  collaborativeProbability: number
}

interface RankedCandidate {
  profile: CandidateProfile
  matchScore: number
  sharedAnswers: number
  disagreement: number | null
}

const exploreActivities = [
  { name: 'Coffee' },
  { name: 'Party' },
  { name: 'Gym' },
  { name: 'Run' },
]

const SUPABASE_CONFIG_ERROR =
  'Supabase is not configured. Add the project URL and publishable key to your hosting environment.'

const latestAdultBirthDate = new Date()
latestAdultBirthDate.setUTCFullYear(latestAdultBirthDate.getUTCFullYear() - 18)
const latestAdultBirthDateInput = latestAdultBirthDate.toISOString().slice(0, 10)

function Icon({
  name,
  size = 20,
}: {
  name: 'compass' | 'activity' | 'calendar' | 'users' | 'message' | 'user' | 'upload' | 'bell' | 'search' | 'arrow' | 'check' | 'heart' | 'bookmark' | 'x' | 'plus' | 'clock' | 'map' | 'trash' | 'spark'
  size?: number
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    bookmark: <><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z" /></>,
    x: <><path d="m18 6-12 12M6 6l12 12" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3ZM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function ProfileImage({
  photoUrl,
  initials,
  className,
  fallbackClassName,
}: {
  photoUrl?: string
  initials: string
  className: string
  fallbackClassName: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [photoUrl])
  if (photoUrl && !failed) {
    return (
      <img
        className={className}
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
      />
    )
  }
  return <span className={fallbackClassName}>{initials}</span>
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || 'You'
}

function isChildrenCompatible(
  ownPreference: ChildrenPreference | null,
  candidatePreference: ChildrenPreference | null,
): boolean {
  if (
    !ownPreference ||
    !candidatePreference ||
    ownPreference === 'Not sure' ||
    candidatePreference === 'Not sure' ||
    ownPreference === 'Open to children' ||
    candidatePreference === 'Open to children'
  ) {
    return true
  }
  return ownPreference === candidatePreference
}

function rankCandidate(
  profile: CandidateProfile,
  answers: Record<string, number>,
): RankedCandidate {
  const sharedQuestions = perspectiveQuestions.filter(
    (question) =>
      answers[question.id] !== undefined &&
      profile.perspectiveAnswers[question.id] !== undefined,
  )
  const disagreement = sharedQuestions.length === 0 ? null :
    sharedQuestions.reduce(
      (total, question) =>
        total +
        Math.abs(answers[question.id] - profile.perspectiveAnswers[question.id]) /
          2,
      0,
    ) / sharedQuestions.length
  const intellectualFit = disagreement === null ? 0.5 : Math.max(
    0,
    1 - Math.abs(disagreement - 0.45) / 0.55,
  )
  const confidence = Math.min(1, sharedQuestions.length / 8)
  const perspectiveScore = intellectualFit * confidence + 0.5 * (1 - confidence)
  const outboundProbability =
    profile.personalLikeProbability * 0.7 + profile.collaborativeProbability * 0.3
  const reciprocalProbability = outboundProbability * profile.reverseLikeProbability
  const matchScore = Math.round(
    100 * Math.pow(Math.max(0.01, reciprocalProbability), 0.4)
      * Math.pow(1, 0.3)
      * Math.pow(Math.max(0.01, perspectiveScore), 0.3),
  )

  return {
    profile,
    matchScore,
    sharedAnswers: sharedQuestions.length,
    disagreement,
  }
}

function App() {
  const [displayName, setDisplayName] = useState('You')
  const [activePage, setActivePage] = useState<Page>('swipe')
  const [notice, setNotice] = useState<string | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<ProfileNotification[]>([])
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesSending, setMessagesSending] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const chatMessagesEndRef = useRef<HTMLDivElement>(null)
  const [selectedMember, setSelectedMember] = useState<CandidateProfile | null>(null)
  const [showPerspectiveQuestion, setShowPerspectiveQuestion] = useState(false)
  const [flippedActivity, setFlippedActivity] = useState<string | null>(null)
  const [profileReactions, setProfileReactions] = useState<Record<string, 'liked' | 'passed'>>({})
  const pendingProfileReactions = useRef(new Set<string>())
  const [perspectiveAnswers, setPerspectiveAnswers] = useState<Record<string, number>>({})
  const perspectiveAnswersRef = useRef<Record<string, number>>({})
  const [draftPerspectiveScores, setDraftPerspectiveScores] = useState<Record<string, number>>({})
  const [swipeDragX, setSwipeDragX] = useState(0)
  const swipeStartX = useRef<number | null>(null)
  const ignoreSwipeClick = useRef(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [discoveryProfiles, setDiscoveryProfiles] = useState<DiscoverableProfile[]>([])
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<
    'loading' | 'anonymous' | 'authenticated' | 'unavailable' | 'unconfigured'
  >(isSupabaseConfigured ? 'loading' : 'unconfigured')
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null)
  const [childrenPreference, setChildrenPreference] =
    useState<ChildrenPreference | null>(null)
  const [gender, setGender] = useState<Gender | null>(null)
  const [genderPreference, setGenderPreference] = useState<GenderPreference>('both')
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
  const [signupStep, setSignupStep] = useState(0)
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupBirthDate, setSignupBirthDate] = useState('')
  const signupEmailCheckInFlight = useRef(false)
  const authFormRef = useRef<HTMLFormElement>(null)
  const [authPending, setAuthPending] = useState(false)
  const [isCheckingSignupEmail, setIsCheckingSignupEmail] = useState(false)
  const [isSavingPerspectiveAnswer, setIsSavingPerspectiveAnswer] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [authError, setAuthError] = useState<string | null>(
    isSupabaseConfigured
      ? null
      : SUPABASE_CONFIG_ERROR,
  )

  useEffect(() => {
    perspectiveAnswersRef.current = perspectiveAnswers
  }, [perspectiveAnswers])

  useEffect(() => {
    if (!accountUser || activePage !== 'messages') return
    let active = true
    void getMyConversations()
      .then((items) => {
        if (!active) return
        setConversations(items)
        if (items.length > 0) setMessagesLoading(true)
        setSelectedConversationId((current) =>
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id ?? null,
        )
      })
      .catch((error: unknown) => {
        if (active) {
          setMessagesError(
            error instanceof Error ? error.message : 'Could not load conversations.',
          )
        }
      })
    return () => { active = false }
  }, [accountUser, activePage])

  useEffect(() => {
    if (!accountUser) return
    let active = true
    const refreshConversations = async () => {
      try {
        const items = await getMyConversations()
        if (active) {
          setConversations(items)
          setMessagesError(null)
        }
      } catch (error) {
        if (active) {
          setMessagesError(
            error instanceof Error ? error.message : 'Could not refresh conversations.',
          )
        }
      }
    }

    void refreshConversations()
    const intervalId = window.setInterval(() => { void refreshConversations() }, 30_000)
    window.addEventListener('focus', refreshConversations)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshConversations)
    }
  }, [accountUser])

  useEffect(() => {
    if (!accountUser || activePage !== 'messages' || !selectedConversationId) {
      return
    }

    let active = true
    const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]) => {
      const byId = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) byId.set(message.id, message)
      return [...byId.values()].sort(
        (first, second) => first.createdAt.localeCompare(second.createdAt),
      )
    }

    const channel = subscribeToConversationMessages(
      selectedConversationId,
      (message) => {
        if (!active) return
        setChatMessages((current) => mergeMessages(current, [message]))
        void getMyConversations()
          .then((items) => { if (active) setConversations(items) })
          .catch((error: unknown) => {
            if (active) {
              setMessagesError(
                error instanceof Error ? error.message : 'Could not refresh conversations.',
              )
            }
          })
        if (message.senderId !== accountUser.id) {
          void markMyConversationRead(selectedConversationId)
            .then(() => getMyConversations())
            .then((items) => { if (active) setConversations(items) })
            .catch((error: unknown) => {
              if (active) {
                setMessagesError(
                  error instanceof Error ? error.message : 'Could not mark messages as read.',
                )
              }
            })
        }
      },
      (error) => { if (active) setMessagesError(error) },
    )

    void getConversationMessages(selectedConversationId)
      .then(async (items) => {
        if (!active) return
        setChatMessages((current) => mergeMessages(current, items))
        await markMyConversationRead(selectedConversationId)
        const refreshedConversations = await getMyConversations()
        if (active) {
          setConversations(refreshedConversations)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessagesError(
            error instanceof Error ? error.message : 'Could not load conversation messages.',
          )
        }
      })
      .finally(() => { if (active) setMessagesLoading(false) })

    return () => {
      active = false
      void requireSupabase().removeChannel(channel)
    }
  }, [accountUser, activePage, selectedConversationId])

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatMessages])

  useEffect(() => {
    if (!selectedMember) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedMember])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    let active = true
    void getCurrentUser()
      .then(async (user) => {
        if (!active) {
          return
        }
        if (new URLSearchParams(window.location.search).has('confirmed')) {
          if (user) {
            await logoutAccount()
          }
          setAccountUser(null)
          setChildrenPreference(null)
          setAuthStatus('anonymous')
          setAuthMode('login')
          setActivePage('profile')
          setNotice('Email confirmed. Sign in to continue.')
          window.history.replaceState({}, '', window.location.pathname)
          return
        }
        setAccountUser(user)
        setChildrenPreference(user?.childrenPreference ?? null)
        setAuthStatus(user ? 'authenticated' : 'anonymous')
        if (user) {
          setActivePage('swipe')
          applyAccountUser(user)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthStatus('unavailable')
          setAuthError(
            error instanceof Error
              ? error.message
              : 'Could not verify the session with Supabase.',
          )
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!accountUser) return
    const userId = accountUser.id
    let active = true
    async function refreshDiscoveryProfiles() {
      try {
        const profiles = await getDiscoverableProfiles()
        if (active) {
          setDiscoveryProfiles(profiles)
          setDiscoveryError(null)
          const ownProfile = profiles.find(
            (profile) => profile.userId === userId,
          )
          setPerspectiveAnswers(ownProfile?.perspectiveAnswers ?? {})
        }
      } catch (error) {
        if (active) {
          setDiscoveryError(
            error instanceof Error
              ? error.message
              : 'Could not load dating profiles.',
          )
        }
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshDiscoveryProfiles()
      }
    }
    void refreshDiscoveryProfiles()
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      active = false
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [accountUser, activePage])

  useEffect(() => {
    if (!accountUser) {
      return
    }

    let active = true
    const refresh = async () => {
      try {
        const items = await getMyNotifications()
        if (active) {
          setNotifications(items)
          setNotificationError(null)
        }
      } catch (error) {
        if (active) {
          setNotificationError(
            error instanceof Error ? error.message : 'Could not load notifications.',
          )
        }
      }
    }
    void refresh()
    const intervalId = window.setInterval(() => { void refresh() }, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
    }
  }, [accountUser])

  const candidates = useMemo(() => {
    const realCandidates: CandidateProfile[] = discoveryProfiles
      .filter((profile) => profile.userId !== accountUser?.id)
      .map((profile) => ({
        id: profile.userId,
        displayName: profile.displayName,
        isDemo: profile.isDemo,
        gender: profile.gender,
        neighborhood: profile.neighborhood ?? 'Location not shared',
        childrenPreference: profile.childrenPreference,
        personality: 'Thoughtful and curious',
        bio: '',
        photoUrl: profile.photoUrl ?? undefined,
        perspectiveAnswers: profile.perspectiveAnswers,
        personalLikeProbability: profile.personalLikeProbability,
        reverseLikeProbability: profile.reverseLikeProbability,
        collaborativeProbability: profile.collaborativeProbability,
      }))
    return realCandidates.filter((profile) => {
      if (!isChildrenCompatible(childrenPreference, profile.childrenPreference)) {
        return false
      }
      if (!matchesGenderPreference(profile.gender, genderPreference)) {
        return false
      }
      return true
    })
  }, [accountUser, childrenPreference, discoveryProfiles, genderPreference])
  const rankedCandidates = useMemo(
    () =>
      candidates
        .map((profile) => rankCandidate(profile, perspectiveAnswers))
        .sort(
          (first, second) =>
            second.matchScore - first.matchScore ||
            (second.disagreement ?? -1) - (first.disagreement ?? -1),
        ),
    [candidates, perspectiveAnswers],
  )
  const availableCandidates = rankedCandidates.filter(
    ({ profile }) => profileReactions[profile.id] === undefined,
  )
  const unansweredPerspectiveQuestions = perspectiveQuestions.filter(
    (question) => perspectiveAnswers[question.id] === undefined,
  )
  const lightweightPerspectiveQuestion = unansweredPerspectiveQuestions[0] ?? null
  const hasUnansweredPerspectiveQuestion = lightweightPerspectiveQuestion !== null
  const messagesBadgeCount =
    conversations.reduce((total, conversation) => total + conversation.unreadCount, 0) +
    notifications.filter((item) => item.readAt === null).length
  const selectedMemberAnswers = selectedMember?.perspectiveAnswers ?? {}
  const sharedProfileQuestions = selectedMember
    ? perspectiveQuestions.filter(
        (question) =>
          perspectiveAnswers[question.id] !== undefined &&
          selectedMember.perspectiveAnswers[question.id] !== undefined,
      )
    : []
  const agreedProfileQuestions = sharedProfileQuestions.filter(
    (question) =>
      Math.abs(
        perspectiveAnswers[question.id] -
          selectedMemberAnswers[question.id],
      ) < 0.5,
  )
  const disagreedProfileQuestions = sharedProfileQuestions.filter(
    (question) =>
      Math.abs(
        perspectiveAnswers[question.id] -
          selectedMemberAnswers[question.id],
      ) >= 0.5,
  )

  useEffect(() => {
    if (activePage === 'discover' && accountUser && hasUnansweredPerspectiveQuestion) {
      setShowPerspectiveQuestion(true)
    }
  }, [activePage, accountUser?.id, hasUnansweredPerspectiveQuestion])

  async function submitChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConversationId || !chatDraft.trim() || messagesSending) return
    setMessagesSending(true)
    setMessagesError(null)
    try {
      const message = await sendMyMessage(selectedConversationId, chatDraft)
      setChatMessages((current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        byId.set(message.id, message)
        return [...byId.values()].sort(
          (first, second) => first.createdAt.localeCompare(second.createdAt),
        )
      })
      setChatDraft('')
      setConversations(await getMyConversations())
    } catch (error) {
      setMessagesError(
        error instanceof Error ? error.message : 'Could not send this message.',
      )
    } finally {
      setMessagesSending(false)
    }
  }

  async function reactToProfile(profile: CandidateProfile, reaction: 'liked' | 'passed') {
    if (pendingProfileReactions.current.has(profile.id)) return
    pendingProfileReactions.current.add(profile.id)
    setDiscoveryError(null)
    setProfileReactions((current) => ({ ...current, [profile.id]: reaction }))
    setSwipeDragX(0)
    try {
      const result = await recordProfileSwipe(profile.id, reaction === 'liked')
      if (result.matched) {
        try {
          setNotifications(await getMyNotifications())
          setNotificationError(null)
        } catch (error) {
          setNotificationError(
            error instanceof Error ? error.message : 'Could not load notifications.',
          )
        }
      }
      void getDiscoverableProfiles().then(setDiscoveryProfiles).catch((error: unknown) => {
        setDiscoveryError(error instanceof Error ? error.message : 'Could not refresh dating profiles.')
      })
    } catch (error) {
      setProfileReactions((current) => {
        if (current[profile.id] !== reaction) return current
        const next = { ...current }
        delete next[profile.id]
        return next
      })
      setDiscoveryError(
        error instanceof Error ? error.message : 'Could not save your profile reaction.',
      )
    } finally {
      pendingProfileReactions.current.delete(profile.id)
    }
  }

  async function uploadProfilePhoto(file: File | undefined) {
    if (!file) return
    setIsUploadingPhoto(true)
    setAuthError(null)
    try {
      const photoUrl = await uploadMyProfilePhoto(file)
      setProfilePhotoUrl(photoUrl)
      const profiles = await getDiscoverableProfiles()
      setDiscoveryProfiles(profiles)
      setNotice('Your profile photo was updated.')
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Could not upload your profile photo.',
      )
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  async function updateFaceLearningConsent(enabled: boolean) {
    try {
      await setMyFaceLearningConsent(enabled)
      setAccountUser((current) => current ? { ...current, faceLearningConsent: enabled } : current)
      setAuthError(null)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not update face learning consent.')
    }
  }

  async function toggleNotifications() {
    const opening = !showNotifications
    setShowNotifications(opening)
    if (!opening || !accountUser) return

    const unreadIds = notifications.filter((item) => item.readAt === null)
    if (unreadIds.length === 0) return
    try {
      await markMyNotificationsRead()
      const readTime = new Date().toISOString()
      setNotifications((current) =>
        current.map((item) => item.readAt === null ? { ...item, readAt: readTime } : item),
      )
    } catch (error) {
      setNotificationError(
        error instanceof Error ? error.message : 'Could not mark notifications as read.',
      )
    }
  }

  function applyAccountUser(user: AccountUser) {
    setAccountUser(user)
    setConversations([])
    setSelectedConversationId(null)
    setChatMessages([])
    setChatDraft('')
    setMessagesError(null)
    setMessagesLoading(false)
    setDisplayName(firstName(user.displayName))
    setChildrenPreference(user.childrenPreference)
    setGender(user.gender)
    setGenderPreference(user.genderPreference)
    setProfilePhotoUrl(user.photoUrl)
    setIsEditingProfile(false)
    setProfileReactions({})
    setSignupStep(0)
    setAuthStatus('authenticated')
  }

  async function advanceSignup() {
    if (!authFormRef.current?.reportValidity()) return
    setAuthError(null)
    if (authMode === 'register' && signupStep === 0) {
      if (signupEmailCheckInFlight.current) return
      signupEmailCheckInFlight.current = true
      setIsCheckingSignupEmail(true)
      try {
        const available = await checkSignupEmailAvailability(signupEmail)
        if (!available) {
          setAuthError('An account with this email already exists. Choose Sign in instead.')
          return
        }
      } catch (error) {
        setAuthError(
          error instanceof Error
            ? error.message
            : 'Could not check this email right now. Try again later.',
        )
        return
      } finally {
        signupEmailCheckInFlight.current = false
        setIsCheckingSignupEmail(false)
      }
    }
    setSignupStep((current) => Math.min(current + 1, onboardingPerspectiveQuestions.length + 3))
  }

  function skipSignupQuestion(questionId: string) {
    const nextAnswers = { ...perspectiveAnswersRef.current }
    delete nextAnswers[questionId]
    perspectiveAnswersRef.current = nextAnswers
    setPerspectiveAnswers(nextAnswers)
    if (signupStep === onboardingPerspectiveQuestions.length + 3) {
      authFormRef.current?.requestSubmit()
    } else {
      void advanceSignup()
    }
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      authMode === 'register' &&
      signupStep < onboardingPerspectiveQuestions.length + 3
    ) {
      await advanceSignup()
      return
    }
    setAuthPending(true)
    setAuthError(null)
    const formData = new FormData(event.currentTarget)
    const email = authMode === 'register'
      ? signupEmail.trim().toLowerCase()
      : String(formData.get('email') ?? '')
    const password = authMode === 'register'
      ? signupPassword
      : String(formData.get('password') ?? '')

    try {
      if (authMode === 'register') {
        const result = await registerAccount({
          email,
          password,
          displayName: signupName,
          birthDate: signupBirthDate,
          intention: 'Dating',
          childrenPreference: childrenPreference ?? 'Not sure',
          gender: gender as Gender,
          genderPreference,
          perspectiveAnswers: perspectiveAnswersRef.current,
        })
        if (result.confirmationRequired) {
          setAuthStatus('anonymous')
          setAuthMode('login')
          setSignupStep(0)
          setActivePage('profile')
          setNotice(
            `Account created. Check ${email} for the confirmation link, then sign in here.`,
          )
          return
        }
        if (!result.user) {
          throw new SupabaseAccountError('Supabase did not return the new profile.')
        }
        applyAccountUser(result.user)
        setActivePage('swipe')
      } else {
        const user = await loginAccount({ email, password })
        applyAccountUser(user)
        setActivePage('swipe')
      }
      setAuthError(null)
      setNotice(authMode === 'register' ? 'Your account was created.' : 'You are signed in.')
    } catch (error) {
      const message = error instanceof SupabaseAccountError
        ? error.message
        : 'Could not reach Supabase. Check the project URL, key, network connection, and Auth configuration.'
      if (
        authMode === 'register' &&
        message.includes('An account with this email already exists.')
      ) {
        setSignupStep(0)
        setAuthError(message)
      } else {
        setAuthError(message)
      }
    } finally {
      setAuthPending(false)
    }
  }

  async function signOut() {
    setAuthPending(true)
    setAuthError(null)
    try {
      await logoutAccount()
      setAccountUser(null)
      setConversations([])
      setSelectedConversationId(null)
      setChatMessages([])
      setChatDraft('')
      setMessagesLoading(false)
      setChildrenPreference(null)
      setGender(null)
      setGenderPreference('both')
      setDiscoveryProfiles([])
      setNotifications([])
      setPerspectiveAnswers({})
      setProfileReactions({})
      setSignupStep(0)
      setIsEditingProfile(false)
      setAuthStatus('anonymous')
      setDisplayName('You')
      setNotice('You are signed out.')
    } catch (error) {
      setAuthError(
        error instanceof SupabaseAccountError
          ? error.message
          : 'Could not reach Supabase to sign out.',
      )
    } finally {
      setAuthPending(false)
    }
  }

  async function savePerspectiveAnswer(questionId: string, score: number): Promise<boolean> {
    const normalizedScore = normalizePerspectiveScore(score)
    setIsSavingPerspectiveAnswer(true)
    try {
      await saveMyPerspectiveAnswer(questionId, normalizedScore)
      setPerspectiveAnswers((current) => ({ ...current, [questionId]: normalizedScore }))
      setDiscoveryError(null)
      return true
    } catch (error) {
      setDiscoveryError(
        error instanceof Error
          ? error.message
          : 'Could not save your perspective answer.',
      )
      return false
    } finally {
      setIsSavingPerspectiveAnswer(false)
    }
  }

  async function saveAccountProfile() {
    if (!accountUser) {
      return
    }
    if (!displayName.trim()) {
      setAuthError('Enter your first name before saving your profile.')
      return
    }
    if (!gender) {
      setAuthError('Choose your gender before saving your profile.')
      return
    }
    setIsSavingProfile(true)
    setAuthError(null)
    try {
      const user = await updateAccountProfile({
        displayName: firstName(displayName),
        intention: 'Dating',
        childrenPreference: childrenPreference ?? 'Not sure',
        gender,
        genderPreference,
        city: accountUser.city,
        neighborhood: accountUser.neighborhood,
        runningPreferences: accountUser.runningPreferences,
      })
      applyAccountUser(user)
      const profiles = await getDiscoverableProfiles()
      setDiscoveryProfiles(profiles)
      setDiscoveryError(null)
      setProfileSaved(true)
      setNotice('Your profile is saved.')
      window.setTimeout(() => setProfileSaved(false), 1800)
    } catch (error) {
      setAuthError(
        error instanceof SupabaseAccountError
          ? error.message
          : 'Could not reach Supabase to save your profile.',
      )
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        'Delete your Opinionated account and Supabase profile? This cannot be undone.',
      )
    ) {
      return
    }
    setAuthPending(true)
    setAuthError(null)
    try {
      await deleteAccountRequest()
      setAccountUser(null)
      setConversations([])
      setSelectedConversationId(null)
      setChatMessages([])
      setChatDraft('')
      setMessagesLoading(false)
      setDiscoveryProfiles([])
      setNotifications([])
      setPerspectiveAnswers({})
      setChildrenPreference(null)
      setGender(null)
      setGenderPreference('both')
      setProfileReactions({})
      setIsEditingProfile(false)
      setDisplayName('You')
      setAuthStatus('anonymous')
      setAuthMode('register')
      setSignupStep(0)
      setNotice('Your account was deleted.')
    } catch (error) {
      setAuthError(
        error instanceof SupabaseAccountError
          ? error.message
          : 'Could not reach Supabase to delete your account.',
      )
    } finally {
      setAuthPending(false)
    }
  }

  const navigation: { id: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { id: 'discover', label: 'Explore', icon: 'compass' },
    { id: 'swipe', label: 'Discover', icon: 'heart' },
    { id: 'messages', label: 'Messages', icon: 'message' },
    { id: 'profile', label: 'Profile', icon: 'user' },
  ]

  function openAuthentication(mode: 'register' | 'login') {
    setAuthMode(mode)
    setSignupStep(0)
    setAuthError(isSupabaseConfigured ? null : SUPABASE_CONFIG_ERROR)
    setActivePage('profile')
  }

  if (!accountUser && authStatus !== 'loading' && activePage !== 'profile') {
    return (
      <div className="landing-page">
        <header className="landing-header">
          <button className="landing-brand" type="button" onClick={() => setActivePage('discover')}>
            {/* <span className="landing-brand-mark"><Icon name="spark" size={20} /></span> */}
            <span>: ( opinionated</span>
          </button>
          <div className="landing-header-actions">
            <button className="landing-signin" type="button" onClick={() => openAuthentication('login')}>Sign in</button>
            <button className="landing-join" type="button" onClick={() => openAuthentication('register')}>Create account <Icon name="arrow" size={15} /></button>
          </div>
        </header>

        <main>
          <section className="landing-hero">
            <div className="landing-hero-copy">
              {/* <div className="landing-eyebrow"><span /> OPINIONATED</div> */}
              <h1>Disagreements are a part of life.</h1>
              <div className="landing-hero-bottom">
                <h3 className="landing-hero-subheading">Can your date handle them well?</h3>
                <div className="landing-hero-actions">
                  <button className="landing-join landing-join-large" type="button" onClick={() => openAuthentication('register')}>Get started <Icon name="arrow" size={16} /></button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className={`app-shell ${!accountUser ? 'public-auth-shell' : ''}${activePage === 'swipe' ? ' swipe-active' : ''}`}>
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => setActivePage('discover')}>
          {/* <span className="brand-mark"><Icon name="spark" size={21} /></span> */}
          <span>
            <strong>:( opinionated</strong>
            {/* <small>Meet with perspective</small> */}
          </span>
        </button>

        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`side-nav-link ${activePage === item.id ? 'selected' : ''}`}
              key={item.id}
              onClick={() => {
                if (item.id === 'swipe') setNotice(null)
                if (item.id === 'messages') setMessagesError(null)
                setActivePage(item.id)
              }}
              type="button"
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'messages' && messagesBadgeCount > 0 && (
                <span className="nav-unread-badge" aria-label={`${messagesBadgeCount} unread or new`}>
                  {messagesBadgeCount > 99 ? '99+' : messagesBadgeCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="profile-shortcut" type="button" onClick={() => setActivePage('profile')}>
            <ProfileImage
              photoUrl={profilePhotoUrl ?? undefined}
              initials={firstName(displayName).slice(0, 1).toUpperCase()}
              className="profile-avatar profile-avatar-image"
              fallbackClassName="profile-avatar"
            />
            <span><strong>{firstName(displayName)}</strong></span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-actions">
            <button className="icon-button notification-button" type="button" aria-label="Notifications" onClick={() => { void toggleNotifications() }}>
              <Icon name="bell" size={19} />
              {notifications.some((item) => item.readAt === null) && <i />}
            </button>
          </div>
          {showNotifications && (
            <div className="notification-popover">
              <strong>Notifications</strong>
              {notificationError && <p role="alert">{notificationError}</p>}
              {notifications.length === 0
                ? <p>You&apos;re all caught up. New match notifications will appear here.</p>
                : notifications.map((item) => (
                    <article className="notification-item" key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.body.replace(/^You and .+ both liked each other\.$/, 'You both liked each other.')}</p>
                    </article>
                  ))}
            </div>
          )}
        </header>
        {notice && (
          <div className="notice-banner" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}

        {activePage === 'discover' && (
          <section className="page-view">
            <div className="results-toolbar">
              <div>
                <h2>Explore activities</h2>
                <p>Pick a way to meet and make a connection.</p>
              </div>
            </div>
            {discoveryError && <p className="auth-error account-error" role="alert">{discoveryError}</p>}
            <div className="activity-grid">
              {exploreActivities.map((activity) => (
                <article
                  className={`activity-card activity-${activity.name.toLowerCase()}${flippedActivity === activity.name ? ' is-flipped' : ''}`}
                  key={activity.name}
                  role="button"
                  tabIndex={0}
                  aria-label={`${activity.name}: coming soon`}
                  aria-expanded={flippedActivity === activity.name}
                  onMouseLeave={() => {
                    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                      setFlippedActivity((current) => current === activity.name ? null : current)
                    }
                  }}
                  onClick={() => {
                    setFlippedActivity((current) => current === activity.name ? null : activity.name)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setFlippedActivity((current) => current === activity.name ? null : activity.name)
                    }
                  }}
                >
                  <div className="activity-card-inner">
                    <div className="activity-card-face activity-card-front" aria-hidden={flippedActivity === activity.name}>
                      <h3>{activity.name}</h3>
                    </div>
                    <div className="activity-card-face activity-card-back" aria-hidden={flippedActivity !== activity.name}>
                      <span>Coming soon</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activePage === 'swipe' && (
          <section className="page-view swipe-page">
            {discoveryError && <p className="auth-error account-error" role="alert">{discoveryError}</p>}
            <p className="swipe-count">{availableCandidates.length} profile{availableCandidates.length === 1 ? '' : 's'} to explore</p>
            {availableCandidates.length === 0 ? (
              <div className="empty-card swipe-empty">
                <span className="empty-icon"><Icon name="heart" size={23} /></span>
                <h3>You&apos;re all caught up</h3>
                <p>There are no more profiles in this deck. New profiles will appear here when available.</p>
              </div>
            ) : (
              <>
                <div className="swipe-stage">
                  {availableCandidates[1] && <div className="swipe-card-back" aria-hidden="true" />}
                  {(() => {
                    const { profile } = availableCandidates[0]
                    return (
                      <article
                        key={profile.id}
                        className="swipe-profile-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${firstName(profile.displayName)}'s profile`}
                        style={{
                          transform: `translateX(${swipeDragX}px) rotate(${swipeDragX * 0.035}deg)`,
                          transition: swipeStartX.current === null ? 'transform 240ms cubic-bezier(.2,.75,.25,1)' : 'none',
                        }}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          swipeStartX.current = event.clientX
                          event.currentTarget.setPointerCapture(event.pointerId)
                        }}
                        onPointerMove={(event) => {
                          if (swipeStartX.current !== null) {
                            setSwipeDragX(event.clientX - swipeStartX.current)
                          }
                        }}
                        onPointerUp={(event) => {
                          if (swipeStartX.current === null) return
                          const offset = event.clientX - swipeStartX.current
                          swipeStartX.current = null
                          if (Math.abs(offset) > 110) {
                            ignoreSwipeClick.current = true
                            window.setTimeout(() => { ignoreSwipeClick.current = false }, 0)
                            const reaction = offset > 0 ? 'liked' : 'passed'
                            setSwipeDragX((offset > 0 ? 1 : -1) * Math.max(window.innerWidth, 520))
                            window.setTimeout(() => { void reactToProfile(profile, reaction) }, 180)
                          } else {
                            setSwipeDragX(0)
                          }
                        }}
                        onPointerCancel={() => {
                          swipeStartX.current = null
                          setSwipeDragX(0)
                        }}
                        onClick={() => {
                          if (ignoreSwipeClick.current) return
                          setSelectedMember(profile)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault()
                            void reactToProfile(profile, event.key === 'ArrowRight' ? 'liked' : 'passed')
                          }
                        }}
                      >
                        <div className="swipe-photo">
                          <ProfileImage
                            photoUrl={profile.photoUrl}
                            initials={firstName(profile.displayName).slice(0, 1).toUpperCase()}
                            className="swipe-photo-image"
                            fallbackClassName="swipe-initials"
                          />
                        </div>
                        <div className="swipe-profile-details">
                          <div className="swipe-name-row">
                            <h2>{firstName(profile.displayName)}</h2>
                            <span>{profile.neighborhood}</span>
                          </div>
                          <p>{profile.bio}</p>
                        </div>
                      </article>
                    )
                  })()}
                </div>
                <div className="swipe-actions">
                  <button
                    className="reaction-button reaction-pass"
                    type="button"
                    aria-label={`Pass on ${firstName(availableCandidates[0].profile.displayName)}`}
                    onClick={() => { void reactToProfile(availableCandidates[0].profile, 'passed') }}
                  ><Icon name="x" size={24} /></button>
                  <button
                    className="reaction-button reaction-like"
                    type="button"
                    aria-label={`Like ${firstName(availableCandidates[0].profile.displayName)}`}
                    onClick={() => { void reactToProfile(availableCandidates[0].profile, 'liked') }}
                  ><Icon name="heart" size={24} /></button>
                </div>
              </>
            )}
          </section>
        )}

        {activePage === 'messages' && (
          <section className="page-view messages-page">
            {messagesError && <p className="auth-error account-error" role="alert">{messagesError}</p>}
            {conversations.length === 0 && !messagesLoading ? (
              <div className="message-empty">
                <span className="message-empty-icon"><Icon name="message" size={26} /></span>
                <h2>No conversations yet</h2>
                <p>When you and another person like each other, your match will appear here.</p>
                <button className="button button-outline" type="button" onClick={() => setActivePage('discover')}>Explore profiles <Icon name="arrow" size={15} /></button>
              </div>
            ) : (
              <div className={`chat-layout${selectedConversationId ? ' has-selection' : ''}`}>
                <aside className={`conversation-list${selectedConversationId ? ' has-selection' : ''}`} aria-label="Your conversations">
                  {conversations.map((conversation) => (
                    <button
                      className={`conversation-list-item${selectedConversationId === conversation.id ? ' selected' : ''}`}
                      key={conversation.id}
                      type="button"
                      onClick={() => {
                        setChatMessages([])
                        setChatDraft('')
                        setMessagesError(null)
                        setMessagesLoading(true)
                        setSelectedConversationId(conversation.id)
                      }}
                    >
                      <span className="conversation-avatar">
                        {conversation.otherPhotoUrl
                          ? <img src={conversation.otherPhotoUrl} alt="" />
                          : firstName(conversation.otherDisplayName).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="conversation-list-copy">
                        <strong>{firstName(conversation.otherDisplayName)}</strong>
                        <small>{conversation.lastMessageContent ?? 'You matched. Say hello!'}</small>
                      </span>
                      {conversation.unreadCount > 0 && <span className="conversation-unread">{conversation.unreadCount}</span>}
                    </button>
                  ))}
                </aside>
                {(() => {
                  const conversation = conversations.find(
                    (item) => item.id === selectedConversationId,
                  )
                  if (!conversation) {
                    return (
                      <div className="chat-panel chat-no-selection">
                        <p>{messagesLoading ? 'Loading conversations…' : 'Choose a conversation to start messaging.'}</p>
                      </div>
                    )
                  }
                  return (
                    <section className="chat-panel" aria-label={`Conversation with ${firstName(conversation.otherDisplayName)}`}>
                      <header className="chat-header">
                        <button
                          className="chat-back-button"
                          type="button"
                          onClick={() => {
                            setChatMessages([])
                            setChatDraft('')
                            setMessagesLoading(false)
                            setSelectedConversationId(null)
                          }}
                        >
                          Back
                        </button>
                        <span className="conversation-avatar">
                          {conversation.otherPhotoUrl
                            ? <img src={conversation.otherPhotoUrl} alt="" />
                            : firstName(conversation.otherDisplayName).slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{firstName(conversation.otherDisplayName)}</strong>
                      </header>
                      <div className="chat-message-list" role="log" aria-live="polite" aria-label="Messages">
                        {messagesLoading && chatMessages.length === 0
                          ? <p className="chat-placeholder">Loading messages…</p>
                          : chatMessages.length === 0
                            ? <p className="chat-placeholder">You matched! Send a thoughtful first message.</p>
                            : chatMessages.map((message) => (
                                <article
                                  className={`chat-message${message.senderId === accountUser?.id ? ' outgoing' : ' incoming'}`}
                                  key={message.id}
                                >
                                  <p>{message.content}</p>
                                  <time dateTime={message.createdAt}>
                                    {new Date(message.createdAt).toLocaleTimeString([], {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })}
                                  </time>
                                </article>
                              ))}
                        <div ref={chatMessagesEndRef} />
                      </div>
                      <form className="chat-composer" onSubmit={(event) => { void submitChatMessage(event) }}>
                        <textarea
                          aria-label="Write a message"
                          placeholder="Write a message…"
                          rows={1}
                          maxLength={4000}
                          value={chatDraft}
                          onChange={(event) => setChatDraft(event.target.value)}
                        />
                        <button className="button button-lime" type="submit" disabled={!chatDraft.trim() || messagesSending}>
                          {messagesSending ? 'Sending…' : 'Send'}
                        </button>
                      </form>
                    </section>
                  )
                })()}
              </div>
            )}
          </section>
        )}

        {activePage === 'profile' && (
          <section className="page-view">
            {accountUser ? (
              <>
                {authError && <p className="auth-error account-error" role="alert">{authError}</p>}
                <div className="profile-layout profile-layout-single">
                  <div className="profile-card perspective-profile-card">
                    <div className="profile-card-header">
                      <div className="profile-avatar-preview">
                        {profilePhotoUrl
                          ? <img src={profilePhotoUrl} alt="" />
                          : <span className="large-profile-avatar">{firstName(displayName).slice(0, 1).toUpperCase()}</span>}
                      </div>
                      <div><strong>{firstName(displayName)}</strong><span>{accountUser.email}</span></div>
                      {!isEditingProfile && (
                        <div className="profile-header-actions">
                          <button className="button button-outline profile-edit-button" type="button" onClick={() => setIsEditingProfile(true)}>
                            Edit profile
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditingProfile ? (
                      <>
                        <label>First name<input value={displayName} required minLength={1} maxLength={60} onChange={(event) => setDisplayName(event.target.value.trim().split(/\s+/)[0] ?? '')} /></label>
                        <label>Profile photo
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={isUploadingPhoto}
                            onChange={(event) => {
                              void uploadProfilePhoto(event.currentTarget.files?.[0])
                              event.currentTarget.value = ''
                            }}
                          />
                          <small>{isUploadingPhoto ? 'Uploading photo…' : 'JPG, PNG, or WebP up to 5 MB'}</small>
                        </label>
                        <label>Relationship goal<input value="Dating" readOnly /></label>
                        <label>Gender
                          <select value={gender ?? ''} required onChange={(event) => setGender(event.target.value as Gender)}>
                            <option value="" disabled>Choose your gender</option>
                            <option value="female">Female</option>
                            <option value="male">Male</option>
                          </select>
                        </label>
                        <label>Show me
                          <select value={genderPreference} onChange={(event) => setGenderPreference(event.target.value as GenderPreference)}>
                            <option value="female">Women</option>
                            <option value="male">Men</option>
                            <option value="both">Everyone</option>
                          </select>
                        </label>
                        <label>Children preference
                          <select value={childrenPreference ?? 'Not sure'} onChange={(event) => setChildrenPreference(event.target.value as ChildrenPreference)}>
                            <option>Want children</option>
                            <option>Open to children</option>
                            <option>Don't want children</option>
                            <option>Not sure</option>
                          </select>
                        </label>
                        <div className="profile-edit-actions">
                          <button
                            className="button button-outline"
                            type="button"
                            disabled={isSavingProfile}
                            onClick={() => {
                              setDisplayName(firstName(accountUser.displayName))
                              setChildrenPreference(accountUser.childrenPreference)
                              setGender(accountUser.gender)
                              setGenderPreference(accountUser.genderPreference)
                              setAuthError(null)
                              setIsEditingProfile(false)
                            }}
                          >
                            Cancel
                          </button>
                          <button className="button button-lime" type="button" disabled={isSavingProfile} onClick={() => { void saveAccountProfile() }}>
                            {profileSaved ? <><Icon name="check" size={16} /> Saved</> : isSavingProfile ? 'Saving…' : 'Save profile'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <dl className="profile-summary">
                        <div><dt>Relationship goal</dt><dd>Dating</dd></div>
                        <div><dt>Gender</dt><dd>{gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : 'Not set'}</dd></div>
                        <div><dt>Show me</dt><dd>{genderPreference === 'both' ? 'Everyone' : genderPreference === 'female' ? 'Women' : 'Men'}</dd></div>
                        <div><dt>Children preference</dt><dd>{childrenPreference ?? 'Not sure'}</dd></div>
                      </dl>
                    )}
                    <label className="face-learning-consent">
                      <input
                        type="checkbox"
                        checked={accountUser.faceLearningConsent}
                        onChange={(event) => { void updateFaceLearningConsent(event.target.checked) }}
                      />
                      <span><strong>Learn my photo preferences</strong><small>Optional. Turn this on before uploading a photo. Private face features personalize recommendations and are never shown on profiles.</small></span>
                    </label>
                  </div>
                </div>
                <div className="profile-account-actions">
                  <button className="delete-account-button profile-signout-button" type="button" disabled={authPending} onClick={() => { void signOut() }}>Sign out</button>
                  <button className="delete-account-button" type="button" disabled={authPending} onClick={() => { void deleteAccount() }}><Icon name="trash" size={14} /> Delete account</button>
                </div>
              </>
            ) : (
              <>
                <div className="auth-layout">
                  <form ref={authFormRef} className="auth-card" onSubmit={(event) => { void submitAuth(event) }}>
                    <div className="auth-mode-tabs" role="tablist" aria-label="Account action">
                      <button type="button" role="tab" aria-selected={authMode === 'register'} className={authMode === 'register' ? 'selected' : ''} onClick={() => { setAuthMode('register'); setSignupStep(0); setAuthError(isSupabaseConfigured ? null : SUPABASE_CONFIG_ERROR) }}>Create account</button>
                      <button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'selected' : ''} onClick={() => { setAuthMode('login'); setSignupStep(0); setAuthError(isSupabaseConfigured ? null : SUPABASE_CONFIG_ERROR) }}>Sign in</button>
                    </div>
                    {authMode === 'register' && (
                      <div className="signup-progress" aria-label={`Create account, step ${signupStep + 1} of ${onboardingPerspectiveQuestions.length + 4}`}>
                        <div className="signup-progress-dots" aria-hidden="true">
                          {Array.from({ length: onboardingPerspectiveQuestions.length + 4 }, (_, index) => (
                            <span className={index === signupStep ? 'active' : index < signupStep ? 'complete' : ''} key={index} />
                          ))}
                        </div>
                        <span>Step {signupStep + 1} of {onboardingPerspectiveQuestions.length + 4}</span>
                      </div>
                    )}
                    <h2>{authMode === 'register'
                      ? signupStep < 2
                        ? 'Personal details'
                        : signupStep === 2
                          ? 'First name'
                          : signupStep === 3
                            ? 'Dating preferences'
                            : 'Perspective question'
                      : 'Welcome back'}</h2>
                    <p className="auth-card-description">{authMode === 'register' ? 'Create an account to find people with compatible relationship goals and different perspectives.' : 'Sign in to pick up where you left off.'}</p>
                    {authMode === 'register' ? (
                      <>
                        {signupStep === 0 && (
                          <div className="signup-step-fields">
                            <label>Email address<input aria-describedby={authError?.includes('An account with this email already exists.') ? 'duplicate-email-error' : 'signup-email-hint'} aria-invalid={authError?.includes('An account with this email already exists.') || undefined} type="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" value={signupEmail} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void advanceSignup() } }} onChange={(event) => { setSignupEmail(event.target.value); if (authError) setAuthError(null) }} />{authError?.includes('An account with this email already exists.') ? <span className="auth-error inline-email-error" id="duplicate-email-error" role="alert">{authError}</span> : <small className="signup-email-hint" id="signup-email-hint">Already have an account? Sign in instead.</small>}</label>
                          </div>
                        )}
                        {signupStep === 1 && (
                          <div className="signup-step-fields">
                            <label>Password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} placeholder="At least 12 characters" value={signupPassword} onChange={(event) => setSignupPassword(event.target.value)} /></label>
                          </div>
                        )}
                        {signupStep === 2 && (
                          <div className="signup-step-fields">
                            <label>First name<input type="text" autoComplete="given-name" required minLength={1} maxLength={60} placeholder="How people will know you" value={signupName} onChange={(event) => setSignupName(event.target.value.trim().split(/\s+/)[0] ?? '')} /></label>
                          </div>
                        )}
                        {signupStep === 3 && (
                          <div className="signup-step-fields">
                            <label>Date of birth<input type="date" autoComplete="bday" required max={latestAdultBirthDateInput} value={signupBirthDate} onChange={(event) => setSignupBirthDate(event.target.value)} /></label>
                            <label>Gender<select value={gender ?? ''} required onChange={(event) => setGender(event.target.value as Gender)}><option value="" disabled>Choose your gender</option><option value="female">Female</option><option value="male">Male</option></select></label>
                            <label>Show me<select value={genderPreference} required onChange={(event) => setGenderPreference(event.target.value as GenderPreference)}><option value="female">Women</option><option value="male">Men</option><option value="both">Everyone</option></select></label>
                            <label>Children preference<select value={childrenPreference ?? 'Not sure'} required onChange={(event) => setChildrenPreference(event.target.value as ChildrenPreference)}><option>Want children</option><option>Open to children</option><option>Don't want children</option><option>Not sure</option></select></label>
                            <p className="adult-note"><Icon name="check" size={14} /> Opinionated is for adults 18 and older.</p>
                          </div>
                        )}
                        {signupStep >= 4 && (() => {
                          const question = onboardingPerspectiveQuestions[signupStep - 4]
                          if (!question) return null
                          return (
                            <fieldset className="signup-questions signup-step-question perspective-questions">
                              <legend>Perspective question {signupStep - 3} of {onboardingPerspectiveQuestions.length}</legend>
                              <p>Choose the point that feels closest. You can skip any question.</p>
                              <label>
                                <span>{question.prompt}</span>
                                <input
                                  type="range"
                                  min="-1"
                                  max="1"
                                  step="0.5"
                                  value={normalizePerspectiveScore(perspectiveAnswers[question.id] ?? 0)}
                                  onChange={(event) => {
                                    const score = normalizePerspectiveScore(Number(event.target.value))
                                    const nextAnswers = { ...perspectiveAnswersRef.current, [question.id]: score }
                                    perspectiveAnswersRef.current = nextAnswers
                                    setPerspectiveAnswers(nextAnswers)
                                  }}
                                />
                                <span className="perspective-slider-labels"><small>{question.leftLabel}</small><small>{question.rightLabel}</small></span>
                              </label>
                            </fieldset>
                          )
                        })()}
                        <div className="signup-navigation">
                          {signupStep > 0 && <button className="button button-outline" type="button" onClick={() => { setAuthError(null); setSignupStep((current) => current - 1) }}>Back</button>}
                          {signupStep < 4 ? (
                            <button className="button button-lime" type="button" disabled={isCheckingSignupEmail} onClick={() => { void advanceSignup() }}>{isCheckingSignupEmail ? 'Checking…' : 'Next'} <Icon name="arrow" size={16} /></button>
                          ) : signupStep < onboardingPerspectiveQuestions.length + 3 ? (
                            <>
                              <button className="button button-outline" type="button" onClick={() => skipSignupQuestion(onboardingPerspectiveQuestions[signupStep - 4].id)}>Skip</button>
                              <button className="button button-lime" type="button" onClick={advanceSignup}>Next <Icon name="arrow" size={16} /></button>
                            </>
                          ) : (
                            <>
                              <button className="button button-outline" type="button" onClick={() => skipSignupQuestion(onboardingPerspectiveQuestions[signupStep - 4].id)}>Skip</button>
                              <button className="button button-lime auth-submit" type="submit" disabled={authPending || !isSupabaseConfigured}>{authPending ? 'Please wait…' : 'Create account'}<Icon name="arrow" size={16} /></button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" /></label>
                        <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} placeholder="Your password" /></label>
                        <button className="button button-lime auth-submit" type="submit" disabled={authPending || !isSupabaseConfigured}>{authPending ? 'Please wait…' : 'Sign in'}<Icon name="arrow" size={16} /></button>
                      </>
                    )}
                    {authError && !authError.includes('An account with this email already exists.') && <p className="auth-error" role="alert">{authError}</p>}
                    <p className="auth-privacy-note">Your perspective profile grows over time. Questions are optional and only shared answers are compared.</p>
                  </form>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {showPerspectiveQuestion && lightweightPerspectiveQuestion && (
        <div className="modal-backdrop question-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPerspectiveQuestion(false) }}>
          <section className="profile-modal question-modal" role="dialog" aria-modal="true" aria-labelledby="question-modal-title">
            <button className="modal-close" type="button" aria-label="Close question" onClick={() => setShowPerspectiveQuestion(false)}><Icon name="x" size={18} /></button>
            {/* <p className="question-modal-eyebrow">PERSPECTIVE QUESTION</p> */}
            <h2 id="question-modal-title">{lightweightPerspectiveQuestion.prompt}</h2>
            <label className="question-modal-slider">
              <input type="range" min="-1" max="1" step="0.5" value={normalizePerspectiveScore(draftPerspectiveScores[lightweightPerspectiveQuestion.id] ?? 0)} onChange={(event) => setDraftPerspectiveScores((current) => ({ ...current, [lightweightPerspectiveQuestion.id]: normalizePerspectiveScore(Number(event.target.value)) }))} />
              <span className="perspective-slider-labels"><small>{lightweightPerspectiveQuestion.leftLabel}</small><small>{lightweightPerspectiveQuestion.rightLabel}</small></span>
            </label>
            <button className="button button-lime" type="button" disabled={isSavingPerspectiveAnswer} onClick={async () => { const saved = await savePerspectiveAnswer(lightweightPerspectiveQuestion.id, draftPerspectiveScores[lightweightPerspectiveQuestion.id] ?? 0); if (saved) { setShowPerspectiveQuestion(false); setActivePage('discover') } }}>
              {isSavingPerspectiveAnswer ? 'Saving…' : 'Save answer'}
            </button>
          </section>
        </div>
      )}

      {selectedMember && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMember(null) }}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="modal-member-name">
            <button className="modal-close" type="button" aria-label="Close profile" onClick={() => setSelectedMember(null)}><Icon name="x" size={18} /></button>
            <div className="modal-portrait">
              <ProfileImage
                photoUrl={selectedMember.photoUrl}
                initials={firstName(selectedMember.displayName).slice(0, 1).toUpperCase()}
                className="modal-photo"
                fallbackClassName="modal-initials"
              />
            </div>
            <h2 id="modal-member-name">{firstName(selectedMember.displayName)}</h2>
            <p className="modal-area"><Icon name="map" size={14} /> {selectedMember.neighborhood}</p>
            <p className="modal-bio"><strong>{selectedMember.personality}.</strong> {selectedMember.bio}</p>
            {sharedProfileQuestions.length === 0 ? (
              <p className="modal-bio">You do not have any shared answers yet. Answer a perspective question to start comparing.</p>
            ) : (
              <div className="perspective-comparison">
                <h3>Things you agree on</h3>
                {agreedProfileQuestions.length > 0
                  ? agreedProfileQuestions.map((question) => (
                      <div className="perspective-agree" key={question.id}>
                        <strong>{question.prompt}</strong>
                      </div>
                    ))
                  : <p>You have different views across the questions you have both answered.</p>}
                <h3>Things you disagree on</h3>
                {disagreedProfileQuestions.length > 0
                  ? disagreedProfileQuestions.slice(0, 3).map((question) => (
                    <div className="perspective-disagree" key={question.id}>
                      <strong>{question.prompt}</strong>
                    </div>
                  ))
                  : <p>You are aligned across the questions you have both answered so far.</p>}
              </div>
            )}
            <div className="profile-reactions modal-reactions">
              <button
                className="reaction-button reaction-pass"
                type="button"
                aria-label={`Pass on ${firstName(selectedMember.displayName)}`}
                onClick={() => {
                  void reactToProfile(selectedMember, 'passed')
                  setSelectedMember(null)
                }}
              ><Icon name="x" size={21} /></button>
              <button
                className="reaction-button reaction-like"
                type="button"
                aria-label={`Like ${firstName(selectedMember.displayName)}`}
                onClick={() => {
                  void reactToProfile(selectedMember, 'liked')
                  setSelectedMember(null)
                }}
              ><Icon name="heart" size={21} /></button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
