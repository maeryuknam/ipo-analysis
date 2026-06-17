const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

// .env 파일에서 API 키 로드
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(__dirname));

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

app.post('/api/analyze', async (req, res) => {
  const { company } = req.body;
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
- 각 point의 text는 반드시 1문장(80자 이내)으로 핵심만, summary와 overallReason도 각 2문장 이내로 짧게 작성하세요.
- 분석은 구체적이고 실무적으로, 한국어로 작성하세요.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      tools: [analysisTool],
      tool_choice: { type: 'tool', name: 'ipo_analysis_report' },
      messages: [{ role: 'user', content: prompt }]
    });

    const toolUse = msg.content.find(c => c.type === 'tool_use');
    if (!toolUse || !Array.isArray(toolUse.input?.sections)) {
      const reason = msg.stop_reason === 'max_tokens'
        ? '분석 내용이 길어 응답이 잘렸습니다. 다시 시도해 주세요.'
        : '분석 결과를 생성하지 못했습니다. 다시 시도해 주세요.';
      return res.status(500).json({ error: reason });
    }

    res.json(toolUse.input);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3737;
app.listen(PORT, () => {
  console.log(`IPO 분석 서버 실행 중: http://localhost:${PORT}/ipo-analysis.html`);
});
