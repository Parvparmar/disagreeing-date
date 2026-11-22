import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const datasetDirectory = path.join(
  projectDirectory,
  'celeb-photos',
  'India_Famous_Person_Dataset',
)
const csvPath = path.join(
  projectDirectory,
  'celeb-photos',
  'India_Famous_Person_Dataset.csv',
)
const bucketName = 'profile-photos'
const questionIds = [
  'people-rational',
  'religion-society',
  'predictability-spontaneity',
  'career-sacrifice',
  'combine-finances',
]
const childrenPreferences = [
  'Want children',
  'Open to children',
  "Don't want children",
  'Not sure',
]
const cities = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai']

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }

  const [headers, ...records] = rows
  if (!headers?.includes('person_name') || !headers.includes('file_name')) {
    throw new Error(`Dataset CSV has an unexpected header: ${csvPath}`)
  }
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])),
  )
}

async function collectJpgs(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJpgs(entryPath))
    } else if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

function emailForName(name) {
  const normalized = name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!normalized) {
    throw new Error(`Could not make a test email for "${name}".`)
  }
  return `${normalized}@test.com`
}

function stableIndex(value, length) {
  const digest = createHash('sha256').update(value).digest()
  return digest.readUInt32BE(0) % length
}

function answersForName(name) {
  return Object.fromEntries(
    questionIds.map((questionId) => {
      const score = stableIndex(`${name}:${questionId}`, 5) - 2
      return [questionId, score / 2]
    }),
  )
}

async function loadDemoProfiles() {
  const csvText = await readFile(csvPath, 'utf8')
  const records = parseCsv(csvText)
  const jpgPaths = await collectJpgs(datasetDirectory)
  const photosByName = new Map()
  for (const jpgPath of jpgPaths) {
    const baseName = path.basename(jpgPath).toLowerCase()
    const paths = photosByName.get(baseName) ?? []
    paths.push(jpgPath)
    photosByName.set(baseName, paths)
  }

  const profilesByName = new Map()
  for (const record of records) {
    const personName = record.person_name.trim()
    if (!personName || profilesByName.has(personName)) continue
    const availablePhotos = photosByName.get(record.file_name.toLowerCase())
    if (availablePhotos?.length) {
      profilesByName.set(personName, {
        personName,
        gender: record.gender.toLowerCase(),
        genderPreference: record.gender.toLowerCase() === 'male' ? 'female' : 'male',
        email: emailForName(personName),
        photoPath: availablePhotos[0],
        perspectiveAnswers: answersForName(personName),
        childrenPreference: childrenPreferences[
          stableIndex(`${personName}:children`, childrenPreferences.length)
        ],
        city: cities[stableIndex(`${personName}:city`, cities.length)],
      })
    }
  }

  const profiles = [...profilesByName.values()]
    .sort((left, right) => left.email.localeCompare(right.email))
  const emailSet = new Set(profiles.map((profile) => profile.email))
  if (emailSet.size !== profiles.length) {
    throw new Error('Two dataset names produce the same test email address.')
  }
  if (profiles.length === 0) {
    throw new Error('No profiles with an available first JPG were found in the dataset.')
  }
  return profiles
}

async function loadSupabase() {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const password = process.env.DEMO_PASSWORD
  if (!url || !secretKey || !password) {
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_SECRET_KEY, and DEMO_PASSWORD before seeding.',
    )
  }
  const parsedUrl = new URL(url)
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)
    && parsedUrl.port === '54321'
    && parsedUrl.protocol === 'http:'
  if (!isLocal) {
    const expectedUrl = process.env.DEMO_SEED_TARGET_URL
    const hostedOptIn = process.env.DEMO_SEED_ALLOW_HOSTED === 'true'
    if (!hostedOptIn || !expectedUrl || url !== expectedUrl) {
      throw new Error(
        'Hosted seeding requires DEMO_SEED_ALLOW_HOSTED=true and DEMO_SEED_TARGET_URL to exactly match SUPABASE_URL.',
      )
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== `${parsedUrl.hostname.split('.')[0]}.supabase.co` ||
      parsedUrl.pathname !== '/' ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      throw new Error('Hosted demo seeding only supports a Supabase project HTTPS URL.')
    }
    console.warn(
      `WARNING: seeding shared-password demo accounts into hosted Supabase at ${parsedUrl.origin}.`,
    )
  }
  if (password.length < 8) {
    throw new Error('DEMO_PASSWORD must contain at least 8 characters.')
  }

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: bucket, error: bucketError } = await client.storage.getBucket(bucketName)
  if (bucketError) {
    throw new Error(`Could not access the ${bucketName} bucket: ${bucketError.message}`)
  }
  if (!bucket.public) {
    throw new Error(`The ${bucketName} bucket must be public to serve profile photos.`)
  }
  return { client, password }
}

async function listUsersByEmail(client) {
  const usersByEmail = new Map()
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Could not list Supabase Auth users: ${error.message}`)
    for (const user of data.users) {
      if (user.email) usersByEmail.set(user.email.toLowerCase(), user)
    }
    if (data.users.length < 1000) break
  }
  return usersByEmail
}

async function seedProfile(client, profile, password, usersByEmail) {
  const userMetadata = {
    display_name: profile.personName,
    birth_date: '1990-01-01',
    intention: 'Dating',
    children_preference: profile.childrenPreference,
    gender: profile.gender,
    gender_preference: profile.genderPreference,
    demo_profile: true,
  }
  let user = usersByEmail.get(profile.email)
  if (user) {
    const { data, error } = await client.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, ...userMetadata },
    })
    if (error) throw new Error(`Could not update ${profile.email}: ${error.message}`)
    user = data.user
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email: profile.email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    })
    if (error) throw new Error(`Could not create ${profile.email}: ${error.message}`)
    user = data.user
    usersByEmail.set(profile.email, user)
  }

  const objectPath = `demo/${user.id}/profile.jpg`
  const image = await readFile(profile.photoPath)
  const { error: uploadError } = await client.storage
    .from(bucketName)
    .upload(objectPath, image, {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: true,
    })
  if (uploadError) {
    throw new Error(`Could not upload the photo for ${profile.email}: ${uploadError.message}`)
  }
  const { data: publicUrl } = client.storage.from(bucketName).getPublicUrl(objectPath)

  const { error: profileError } = await client
    .from('profiles')
    .update({
      children_preference: profile.childrenPreference,
      gender: profile.gender,
      gender_preference: profile.genderPreference,
      city: profile.city,
      neighborhood: `${profile.city} · Demo`,
      photo_url: publicUrl.publicUrl,
      is_demo: true,
    })
    .eq('user_id', user.id)
  if (profileError) {
    throw new Error(`Could not update the profile for ${profile.email}: ${profileError.message}`)
  }

  const answers = Object.entries(profile.perspectiveAnswers).map(([questionId, score]) => ({
    user_id: user.id,
    question_id: questionId,
    score,
  }))
  const { error: answersError } = await client
    .from('perspective_answers')
    .upsert(answers, { onConflict: 'user_id,question_id' })
  if (answersError) {
    throw new Error(`Could not save perspective answers for ${profile.email}: ${answersError.message}`)
  }
  const { error: discoveryError } = await client
    .from('runner_discovery')
    .update({ perspective_answers: profile.perspectiveAnswers })
    .eq('user_id', user.id)
  if (discoveryError) {
    throw new Error(`Could not update discovery answers for ${profile.email}: ${discoveryError.message}`)
  }
}

const profiles = await loadDemoProfiles()
if (process.argv.includes('--dry-run')) {
  console.log(`Validated ${profiles.length} demo profiles and first-photo paths.`)
  console.log(
    `Example login: ${profiles.find((profile) => profile.email === 'aliabhatt@test.com')?.email ?? profiles[0].email}`,
  )
} else {
  const { client, password } = await loadSupabase()
  const usersByEmail = await listUsersByEmail(client)
  console.log(`Seeding ${profiles.length} test accounts into local Supabase.`)
  for (const [index, profile] of profiles.entries()) {
    await seedProfile(client, profile, password, usersByEmail)
    console.log(`[${index + 1}/${profiles.length}] ${profile.email}`)
  }
  console.log(`Finished. Password is the value supplied as DEMO_PASSWORD.`)
}
