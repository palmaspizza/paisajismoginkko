exports.handler = async function(event) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: event.body
    }
  );
  const data = await res.json();
  return {
    statusCode: res.status,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data)
  };
};
