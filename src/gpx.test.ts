// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { calculateFingerprint, parseGpx } from './gpx'

const gpxWithTwoRuns = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Morning activity</name>
    <trkseg>
      <trkpt lat="12.0000" lon="77.0000"><ele>100</ele><time>2026-11-10T02:00:00Z</time></trkpt>
      <trkpt lat="12.0010" lon="77.0000"><ele>105</ele><time>2026-11-10T02:01:00Z</time></trkpt>
    </trkseg>
  </trk>
  <trk>
    <name>Evening activity</name>
    <trkseg>
      <trkpt lat="12.0000" lon="77.0000"><time>2026-11-12T12:00:00Z</time></trkpt>
      <trkpt lat="12.0000" lon="77.0010"><time>2026-11-12T12:01:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

describe('parseGpx', () => {
  it('keeps separate tracks as separate activities and calculates distance and pace', () => {
    const activities = parseGpx(gpxWithTwoRuns)

    expect(activities).toHaveLength(2)
    expect(activities[0].distanceKm).toBeCloseTo(0.111, 2)
    expect(activities[0].durationSeconds).toBe(60)
    expect(activities[0].paceSecondsPerKm).toBeCloseTo(540, 0)
    expect(activities[0].elevationGainMeters).toBe(5)
    expect(activities[1].paceSecondsPerKm).toBeGreaterThan(0)
    expect(activities.every((activity) => !('latitude' in activity))).toBe(true)
  })

  it('tolerates repeated XML declarations in exported files', () => {
    const repeatedDeclaration = `<?xml version="1.0"?>${gpxWithTwoRuns}`

    expect(parseGpx(repeatedDeclaration)).toHaveLength(2)
  })

  it('rejects malformed XML and document type declarations', () => {
    expect(() => parseGpx('<gpx><trk>')).toThrow('not valid GPX/XML')
    expect(() =>
      parseGpx('<!DOCTYPE gpx [<!ENTITY x "x">]><gpx />'),
    ).toThrow('document type declaration')
  })

  it('rejects tracks without enough valid points', () => {
    const invalidTrack = `<gpx xmlns="http://www.topografix.com/GPX/1/1">
      <trk><trkseg>
        <trkpt lat="91" lon="77" />
        <trkpt lon="77" />
      </trkseg></trk>
    </gpx>`

    expect(() => parseGpx(invalidTrack)).toThrow('at least two valid GPS points')
  })
})

describe('calculateFingerprint', () => {
  it('calculates total distance, medians, activity frequency and preferred days', () => {
    const activities = parseGpx(gpxWithTwoRuns)
    const fingerprint = calculateFingerprint(activities)

    expect(fingerprint.runCount).toBe(2)
    expect(fingerprint.totalDistanceKm).toBeCloseTo(0.222, 2)
    expect(fingerprint.medianDistanceKm).toBeCloseTo(0.111, 2)
    expect(fingerprint.medianPaceSecondsPerKm).toBeGreaterThan(500)
    expect(fingerprint.runsPerWeek).toBe(2)
    expect(fingerprint.preferredDays).toEqual(['Tue', 'Thu'])
  })
})
