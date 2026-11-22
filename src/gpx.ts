export interface RunActivity {
  id: string
  name: string
  startedAt: string | null
  distanceKm: number
  durationSeconds: number | null
  paceSecondsPerKm: number | null
  elevationGainMeters: number | null
  pointCount: number
}

interface TrackPoint {
  latitude: number
  longitude: number
  elevation: number | null
  timestamp: number | null
}

const EARTH_RADIUS_METERS = 6_371_000
export const MAX_GPX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_GPX_POINTS = 500_000

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function distanceBetween(first: TrackPoint, second: TrackPoint): number {
  const latitudeDelta = radians(second.latitude - first.latitude)
  const longitudeDelta = radians(second.longitude - first.longitude)
  const firstLatitude = radians(first.latitude)
  const secondLatitude = radians(second.latitude)
  const haversine = Math.min(1, Math.max(0,
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2,
  ))

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  )
}

function directChildren(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName.toLowerCase() === localName,
  )
}

function readTrackPoint(element: Element): TrackPoint | null {
  const latitudeText = element.getAttribute('lat')
  const longitudeText = element.getAttribute('lon')

  if (latitudeText === null || longitudeText === null) {
    return null
  }

  const latitude = Number(latitudeText)
  const longitude = Number(longitudeText)

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  const elevationText = directChildren(element, 'ele')[0]?.textContent?.trim()
  const timeText = directChildren(element, 'time')[0]?.textContent?.trim()
  const elevation = elevationText ? Number(elevationText) : Number.NaN
  const timestamp = timeText ? Date.parse(timeText) : Number.NaN

  return {
    latitude,
    longitude,
    elevation: Number.isFinite(elevation) ? elevation : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
  }
}

function summarizeTrack(track: Element, index: number): RunActivity | null {
  const points = directChildren(track, 'trkseg').flatMap((segment) =>
    directChildren(segment, 'trkpt')
      .map(readTrackPoint)
      .filter((point): point is TrackPoint => point !== null),
  )

  if (points.length < 2) {
    return null
  }

  let distanceMeters = 0
  let elevationGainMeters = 0
  let hasElevation = false

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1]
    const current = points[pointIndex]

    distanceMeters += distanceBetween(previous, current)

    if (previous.elevation !== null && current.elevation !== null) {
      hasElevation = true
      const elevationDelta = current.elevation - previous.elevation
      if (elevationDelta > 3) {
        elevationGainMeters += elevationDelta
      }
    }
  }

  const timestamps = points
    .map((point) => point.timestamp)
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((first, second) => first - second)
  const startedAt = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null
  const durationSeconds =
    timestamps.length > 1
      ? Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000)
      : null
  const distanceKm = distanceMeters / 1000
  const paceSecondsPerKm =
    durationSeconds !== null && distanceKm > 0
      ? durationSeconds / distanceKm
      : null

  return {
    id: `${startedAt ?? 'undated'}-${Math.round(distanceMeters)}-${durationSeconds ?? 'na'}`,
    name: `Run ${index + 1}`,
    startedAt,
    distanceKm,
    durationSeconds,
    paceSecondsPerKm,
    elevationGainMeters: hasElevation ? elevationGainMeters : null,
    pointCount: points.length,
  }
}

export function parseGpx(xml: string): RunActivity[] {
  if (xml.length === 0) {
    throw new Error('This GPX file is empty.')
  }

  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error('GPX files containing a document type declaration are not supported.')
  }

  const normalizedXml = xml.replace(/<\?xml[^?]*\?>/gi, '')
  const document = new DOMParser().parseFromString(normalizedXml, 'application/xml')

  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('This file is not valid GPX/XML.')
  }

  const tracks = Array.from(document.getElementsByTagNameNS('*', 'trk'))

  if (tracks.length === 0) {
    throw new Error('No GPX tracks were found in this file.')
  }

  const totalPoints = tracks.reduce(
    (total, track) =>
      total +
      directChildren(track, 'trkseg').reduce(
        (segmentTotal, segment) =>
          segmentTotal + directChildren(segment, 'trkpt').length,
        0,
      ),
    0,
  )

  if (totalPoints > MAX_GPX_POINTS) {
    throw new Error(
      `This file has more than ${MAX_GPX_POINTS.toLocaleString()} track points and is too large to process safely.`,
    )
  }

  const activities = tracks
    .map((track, index) => summarizeTrack(track, index))
    .filter((activity): activity is RunActivity => activity !== null)

  if (activities.length === 0) {
    throw new Error('No tracks with at least two valid GPS points were found.')
  }

  return activities
}

export function calculateFingerprint(activities: RunActivity[]) {
  const sortedActivities = [...activities].sort(
    (first, second) =>
      new Date(first.startedAt ?? 0).getTime() -
      new Date(second.startedAt ?? 0).getTime(),
  )
  const datedActivities = sortedActivities.filter(
    (activity) => activity.startedAt !== null,
  )
  const paces = sortedActivities
    .map((activity) => activity.paceSecondsPerKm)
    .filter((pace): pace is number => pace !== null && Number.isFinite(pace))
    .sort((first, second) => first - second)
  const distances = sortedActivities
    .map((activity) => activity.distanceKm)
    .sort((first, second) => first - second)
  const firstDate = datedActivities[0]?.startedAt
  const lastDate = datedActivities[datedActivities.length - 1]?.startedAt
  const coverageDays =
    firstDate && lastDate
      ? Math.max(
          7,
          (new Date(lastDate).getTime() - new Date(firstDate).getTime()) /
            86_400_000 +
            1,
        )
      : 7

  const median = (values: number[]) => {
    if (values.length === 0) {
      return null
    }

    const middle = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle]
  }

  const dayCounts = new Map<string, number>()
  for (const activity of datedActivities) {
    const day = new Date(activity.startedAt!).toLocaleDateString('en-US', {
      weekday: 'short',
    })
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
  }

  const preferredDays = [...dayCounts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 3)
    .map(([day]) => day)

  return {
    totalDistanceKm: sortedActivities.reduce(
      (total, activity) => total + activity.distanceKm,
      0,
    ),
    runCount: sortedActivities.length,
    medianDistanceKm: median(distances),
    medianPaceSecondsPerKm: median(paces),
    runsPerWeek: sortedActivities.length / (coverageDays / 7),
    preferredDays,
    firstRunAt: firstDate ?? null,
    lastRunAt: lastDate ?? null,
  }
}

export function isRunActivity(value: unknown): value is RunActivity {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const activity = value as Partial<RunActivity>
  return (
    typeof activity.id === 'string' &&
    typeof activity.name === 'string' &&
    (activity.startedAt === null || typeof activity.startedAt === 'string') &&
    typeof activity.distanceKm === 'number' &&
    (activity.durationSeconds === null ||
      typeof activity.durationSeconds === 'number') &&
    (activity.paceSecondsPerKm === null ||
      typeof activity.paceSecondsPerKm === 'number') &&
    (activity.elevationGainMeters === null ||
      typeof activity.elevationGainMeters === 'number') &&
    typeof activity.pointCount === 'number'
  )
}
