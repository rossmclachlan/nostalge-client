import type { JSONOutputFormat } from '@anthropic-ai/sdk/resources/messages'

/**
 * JSON Schemas for the two structured-output calls.
 *
 * Structured outputs are strict about shape: every object needs
 * `additionalProperties: false` and a `required` array listing every property.
 * Numeric and string *constraints* (minimum, maxLength, …) are not supported —
 * ranges are documented in the descriptions and clamped in `normalise.ts`.
 */

const stringArray = (description: string) => ({
  type: 'array' as const,
  items: { type: 'string' as const },
  description,
})

export const PLAN_SCHEMA: JSONOutputFormat['schema'] = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title_hint',
    'intent',
    'length',
    'filters',
    'weights',
    'constraints',
    'sequencing',
  ],
  properties: {
    title_hint: { type: 'string', description: 'A working title for the playlist.' },
    intent: {
      type: 'string',
      description: 'One sentence on what this playlist is for, for the curator to build against.',
    },
    length: {
      type: 'object',
      additionalProperties: false,
      required: ['tracks'],
      properties: {
        tracks: {
          type: 'integer',
          description: 'Target track count. 10-12 short, 16-20 normal, 25-30 for a long evening.',
        },
      },
    },
    filters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'include_tags',
        'exclude_tags',
        'include_artists',
        'exclude_artists',
        'year_from',
        'year_to',
        'play_count_band',
        'last_played',
        'time_of_day',
      ],
      properties: {
        include_tags: stringArray(
          'Tag names to search for, taken from the collection digest. Cast wide: 10-30 is normal.',
        ),
        exclude_tags: stringArray('Tag names to keep out. Usually empty.'),
        include_artists: stringArray('Exact artist names to restrict to. Usually empty.'),
        exclude_artists: stringArray('Exact artist names to keep out. Usually empty.'),
        year_from: {
          type: 'integer',
          description: 'Earliest release year from year tags. 0 when the request is not about a period.',
        },
        year_to: {
          type: 'integer',
          description: 'Latest release year from year tags. 0 when unset.',
        },
        play_count_band: {
          type: 'string',
          enum: ['any', 'low', 'medium', 'high'],
          description: 'Album play-count band relative to the rest of the collection.',
        },
        last_played: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'days'],
          properties: {
            mode: {
              type: 'string',
              enum: ['any', 'never', 'not_within_days', 'within_days'],
              description:
                'Recency constraint. Prefer not_within_days ~180 for open-ended requests.',
            },
            days: {
              type: 'integer',
              description: 'Day count for not_within_days / within_days. 0 otherwise.',
            },
          },
        },
        time_of_day: {
          type: 'string',
          enum: ['any', 'morning', 'afternoon', 'evening', 'late_night'],
          description: 'Match against the hour records were historically played.',
        },
      },
    },
    weights: {
      type: 'object',
      additionalProperties: false,
      required: ['neglect', 'deep_cut'],
      properties: {
        neglect: {
          type: 'number',
          description: '0 to 1. How hard to favour records left on the shelf.',
        },
        deep_cut: {
          type: 'number',
          description: '0 to 1. How hard to favour low-play tracks on well-played albums.',
        },
      },
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      required: ['max_per_artist', 'max_per_album'],
      properties: {
        max_per_artist: { type: 'integer', description: 'Usually 2.' },
        max_per_album: { type: 'integer', description: 'Usually 1.' },
      },
    },
    sequencing: {
      type: 'object',
      additionalProperties: false,
      required: ['arc', 'opener_note', 'closer_note'],
      properties: {
        arc: {
          type: 'string',
          enum: ['slow_build', 'front_loaded', 'even', 'wind_down'],
        },
        opener_note: { type: 'string', description: 'How the set should start. Not a track name.' },
        closer_note: { type: 'string', description: 'How the set should end. Not a track name.' },
      },
    },
  },
}

export const PLAYLIST_SCHEMA: JSONOutputFormat['schema'] = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'liner_note', 'tracks'],
  properties: {
    title: { type: 'string', description: 'A title for the playlist. Short, not a sentence.' },
    liner_note: {
      type: 'string',
      description:
        'Three or four sentences on why these records, together, now. Plain prose, no lists.',
    },
    tracks: {
      type: 'array',
      description: 'The sequenced playlist, in playing order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'reason'],
        properties: {
          ref: {
            type: 'string',
            description: 'The exact ref value of a supplied candidate. Never invented.',
          },
          reason: {
            type: 'string',
            description: 'One concrete line on what this track is doing in this position.',
          },
        },
      },
    },
  },
}
