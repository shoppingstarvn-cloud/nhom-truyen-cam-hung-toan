// ==================== AI SEARCH ASSISTANT (Phase 2) ====================
// Calls Anthropic API to analyze a Vietnamese search query and explain results.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const ANALYZE_SYSTEM_PROMPT = `Bạn là trợ lý phân tích truy vấn tìm kiếm cho website học liệu giáo dục "NHÓM TRUYỀN CẢM HỨNG TOÁN" (tài liệu giảng dạy, đề thi, sáng kiến kinh nghiệm, giáo án, video, hồ sơ giáo viên, album ảnh, tin tức, danh mục tài liệu).

Người hỏi có thể là giáo viên hoặc học sinh. Phân tích câu hỏi của họ (có thể kèm lịch sử trò chuyện trước đó) và trả về DUY NHẤT một đối tượng JSON, không kèm giải thích, không markdown, theo đúng cấu trúc:

{
  "intent": "mô tả ngắn ý định người dùng, ví dụ: tìm tài liệu, tìm video, tìm giáo viên, tìm đề thi, hỏi chung",
  "entities": {
    "subject": "môn học nếu có, ví dụ Toán, Ngữ văn, hoặc null",
    "grade": "lớp/khối nếu có, ví dụ Lớp 9, hoặc null",
    "resource_type": "loại tài liệu nếu có: đề thi, sáng kiến kinh nghiệm, giáo án, bài giảng, video, hoặc null",
    "purpose": "mục đích nếu có: ôn thi, giảng dạy, tham khảo, hoặc null"
  },
  "search_query": "từ khóa tiếng Việt ngắn gọn, súc tích để tìm kiếm trong hệ thống (kết hợp các entities đã nhận diện)",
  "needs_clarification": true hoặc false,
  "clarification_question": "câu hỏi làm rõ bằng tiếng Việt nếu needs_clarification=true, ngược lại để chuỗi rỗng"
}

Chỉ đặt needs_clarification=true khi câu hỏi quá mơ hồ để tạo search_query hữu ích (ví dụ người dùng chỉ nói "tìm tài liệu" mà không nói môn học, lớp hay loại tài liệu nào). Nếu có thể suy luận hợp lý từ ngữ cảnh, hãy đặt needs_clarification=false và tạo search_query tốt nhất có thể.`;

const EXPLAIN_SYSTEM_PROMPT = `Bạn là trợ lý tìm kiếm thân thiện cho website học liệu giáo dục "NHÓM TRUYỀN CẢM HỨNG TOÁN". Bạn sẽ nhận câu hỏi gốc của người dùng và danh sách kết quả tìm được (dạng JSON). Hãy trả về DUY NHẤT một đối tượng JSON, không kèm giải thích, không markdown, theo cấu trúc:

{
  "explanation": "1-2 câu tiếng Việt, thân thiện, tóm tắt kết quả tìm được liên quan thế nào đến câu hỏi của người dùng. Nếu không có kết quả, an ủi và gợi ý cách diễn đạt khác.",
  "follow_up_question": "một câu hỏi gợi mở tiếp theo bằng tiếng Việt để giúp người dùng tìm chính xác hơn, hoặc chuỗi rỗng nếu không cần"
}`;

async function callClaude(apiKey, systemPrompt, messages, maxTokens = 512) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  return text;
}

function parseJson(text, fallback) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (e) {
    return fallback;
  }
}

async function analyzeQuery(apiKey, query, conversationHistory = []) {
  const messages = [
    ...conversationHistory.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
    { role: 'user', content: query },
  ];
  const text = await callClaude(apiKey, ANALYZE_SYSTEM_PROMPT, messages, 400);
  return parseJson(text, {
    intent: 'tìm chung',
    entities: {},
    search_query: query,
    needs_clarification: false,
    clarification_question: '',
  });
}

async function explainResults(apiKey, query, results, intent) {
  const messages = [
    {
      role: 'user',
      content: JSON.stringify({
        query,
        intent,
        results: results.map(r => ({ type: r.type, title: r.title, snippet: r.snippet })),
      }),
    },
  ];
  const text = await callClaude(apiKey, EXPLAIN_SYSTEM_PROMPT, messages, 300);
  return parseJson(text, {
    explanation: results.length
      ? `Tìm thấy ${results.length} kết quả phù hợp với yêu cầu của bạn.`
      : 'Không tìm thấy kết quả phù hợp, bạn thử mô tả khác xem nhé.',
    follow_up_question: '',
  });
}

module.exports = { analyzeQuery, explainResults };
