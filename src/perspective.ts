export type PerspectiveDimension =
  | 'Politics & governance'
  | 'Religion & spirituality'
  | 'Lifestyle & traditions'
  | 'Career & ambition'
  | 'Money & economics'
  | 'Technology & AI'
  | 'Social issues'
  | 'Philosophy & ethics'

export interface PerspectiveQuestion {
  id: string
  dimension: PerspectiveDimension
  prompt: string
  leftLabel: string
  rightLabel: string
}

export function normalizePerspectiveScore(score: number): number {
  return Math.max(-1, Math.min(1, Math.round(score * 2) / 2))
}

export const perspectiveQuestions: PerspectiveQuestion[] = [
  {
    id: 'people-rational',
    dimension: 'Social issues',
    prompt: 'Are people mostly rational or do emotions drive their decisions?',
    leftLabel: 'People are mostly rational',
    rightLabel: 'Emotions drive decisions',
  },
  {
    id: 'leader-competence-transparency',
    dimension: 'Politics & governance',
    prompt: 'Would you rather have a highly competent leader with limited transparency, or a transparent leader who is less effective?',
    leftLabel: 'Competence and results',
    rightLabel: 'Transparency and accountability',
  },
  {
    id: 'personal-freedom-harm',
    dimension: 'Politics & governance',
    prompt: 'Should people be free to make decisions that are objectively bad for their own well-being?',
    leftLabel: 'Personal freedom comes first',
    rightLabel: 'Intervene when harm is foreseeable',
  },
  {
    id: 'religion-society',
    dimension: 'Religion & spirituality',
    prompt: 'Is religion more beneficial or harmful to society overall?',
    leftLabel: 'More beneficial',
    rightLabel: 'More harmful',
  },
  {
    id: 'morality-religion',
    dimension: 'Religion & spirituality',
    prompt: 'Do you believe morality exists independently of religion?',
    leftLabel: 'Reason and empathy',
    rightLabel: 'Religion or spirituality',
  },
  {
    id: 'predictability-spontaneity',
    dimension: 'Lifestyle & traditions',
    prompt: 'Would you prefer a life that is predictable and stable or spontaneous and uncertain?',
    leftLabel: 'Stability',
    rightLabel: 'Spontaneity',
  },
  {
    id: 'traditions',
    dimension: 'Lifestyle & traditions',
    prompt: 'Should traditions be preserved even when younger generations no longer relate to them?',
    leftLabel: 'Preserve traditions',
    rightLabel: 'Traditions should evolve',
  },
  {
    id: 'big-city',
    dimension: 'Lifestyle & traditions',
    prompt: 'Is living in a big city worth the stress and expense?',
    leftLabel: 'Opportunity is worth it',
    rightLabel: 'Peace and space matter more',
  },
  {
    id: 'career-sacrifice',
    dimension: 'Career & ambition',
    prompt: 'Would you sacrifice five years of your personal life to become exceptionally successful?',
    leftLabel: 'The sacrifice can pay off',
    rightLabel: 'Life should not be postponed',
  },
  {
    id: 'ambition-attractive',
    dimension: 'Career & ambition',
    prompt: 'Is ambition attractive even when someone is rarely satisfied with what they have?',
    leftLabel: 'Drive is attractive',
    rightLabel: 'Contentment matters more',
  },
  {
    id: 'combine-finances',
    dimension: 'Money & economics',
    prompt: 'Should couples combine their finances after marriage?',
    leftLabel: 'Build one financial life',
    rightLabel: 'Keep financial independence',
  },
  {
    id: 'money-passion',
    dimension: 'Money & economics',
    prompt: 'Would you rather earn ₹50 lakh doing something you love or ₹1 crore doing something you find mediocre?',
    leftLabel: '₹50 lakh doing what I love',
    rightLabel: '₹1 crore and financial freedom',
  },
  {
    id: 'ai-life-decisions',
    dimension: 'Technology & AI',
    prompt: 'Would you trust an AI to make an important decision about your life if it were statistically better than a human?',
    leftLabel: 'Better outcomes matter',
    rightLabel: 'Keep some decisions human',
  },
  {
    id: 'living-200-years',
    dimension: 'Technology & AI',
    prompt: 'If technology could eliminate ageing but you had to live for 200 years, would you take it?',
    leftLabel: 'Experience as much as possible',
    rightLabel: 'A finite life has meaning',
  },
  {
    id: 'intentions-consequences',
    dimension: 'Social issues',
    prompt: 'Should people be judged primarily by their intentions or by the consequences of their actions?',
    leftLabel: 'Intentions',
    rightLabel: 'Consequences',
  },
  {
    id: 'truth-lie',
    dimension: 'Social issues',
    prompt: 'Is it better to tell a painful truth or a comforting lie?',
    leftLabel: 'Always tell the truth',
    rightLabel: 'Some lies are kinder',
  },
  {
    id: 'people-change',
    dimension: 'Philosophy & ethics',
    prompt: 'Do you believe people fundamentally change, or mostly remain who they are?',
    leftLabel: 'People can transform',
    rightLabel: 'Core personality remains',
  },
  {
    id: 'happiness-truth',
    dimension: 'Philosophy & ethics',
    prompt: 'Would you choose happiness or truth if knowing the truth made you unhappy?',
    leftLabel: 'Happiness',
    rightLabel: 'Truth',
  },
  {
    id: 'love-feeling-decision',
    dimension: 'Philosophy & ethics',
    prompt: 'Is love primarily a feeling or a conscious decision?',
    leftLabel: 'A feeling',
    rightLabel: 'A decision',
  },
  {
    id: 'know-death',
    dimension: 'Philosophy & ethics',
    prompt: 'If you could know exactly when and how you would die, would you want to know?',
    leftLabel: 'Yes, I would plan',
    rightLabel: 'No, uncertainty matters',
  },
]

export const onboardingPerspectiveQuestions = [
  perspectiveQuestions[0],
  perspectiveQuestions[3],
  perspectiveQuestions[5],
  perspectiveQuestions[8],
  perspectiveQuestions[10],
]
