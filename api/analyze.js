const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 분석 결과 구조를 tool schema로 강제 → JSON 파싱 오류 원천 차단
const analysisTool = {
  name: 'ipo_analysis_report',
  description: 'IPO 투자 분석 리포트를 구조화된 형태로 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '분석 대상 회사명' },
      summary: { type: 'string', description: '3줄 이내 핵심 요약' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ['narrative', 'moat', 'overhang', 'macro'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            verdict: { type: 'string', enum: ['긍정적', '중립', '부정적'] },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['positive', 'negative', 'neutral', 'warning'] },
                  text: { type: 'string', description: '구체적이고 실무적인 분석 내용' }
                },
                required: ['type', 'text']
              }
            }
          },
          required: ['id', 'title', 'subtitle', 'verdict', 'points']
        }
      },
      overall: { type: 'string', enum: ['투자 긍정', '추가 검토 필요', '투자 보류'] },
      overallReason: { type: 'string', description: '최종 종합 의견 2~3문장' }
    },
    required: ['company', 'summary', 'sections', 'overall', 'overallReason']
  }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 허용됩니다.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { company } = body;
  if (!company) return res.status(400).json({ error: '회사명이 필요합니다.' });

  const prompt = `당신은 10년 이상 경력의 기술주 전문 애널리스트입니다. 유니콘 기업을 초기에 발굴해 큰 수익을 낸 경험이 있습니다.

"${company}"에 대한 IPO 투자 분석을 아래 4가지 관점에서 수행하세요. 반드시 ipo_analysis_report 도구를 사용해 결과를 제출하세요.

분석할 4개 섹션 (id / title / subtitle 고정):
1. id=narrative, title="내러티브의 현실화", subtitle="진짜 돈이 되는 구조인가?"
2. id=moat, title="해자(Moat)의 본질", subtitle="진짜 기술인가, 마케팅의 결과인가?"
3. id=overhang, title="오버행과 밸류에이션", subtitle="누구를 위한 상장인가?"
4. id=macro, title="거시 환경(Macro)과의 싱크로율", subtitle="시장 타이밍과 외부 리스크"

지침:
- 알려진 사실 기반으로 분석하되, 불확실하거나 비상장으로 정보가 제한적인 부분은 명시하세요.
- 각 섹션의 points는 정확히 3개, 긍정/부정/경고/중립을 균형있게 담으세요.
- 각 point의 text는 1~2문장으로 간결하게, summary와 overallReason도 짧게 핵심만 작성하세요.
- 분석은 구체적이고 실무적으로, 한국어로 작성하세요.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [analysisTool],
      tool_choice: { type: 'tool', name: 'ipo_analysis_report' },
      messages: [{ role: 'user', content: prompt }]
    });

    const toolUse = msg.content.find(c => c.type === 'tool_use');
    if (!toolUse) return res.status(500).json({ error: '분석 결과를 생성하지 못했습니다.' });

    res.status(200).json(toolUse.input);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
