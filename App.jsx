import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Thay bằng URL và Key thực tế của anh trên Supabase Dashboard
const supabaseUrl = 'https://clalkraxfaeqbkeaikow.supabase.co'; 
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY'; // Anh lấy ở phần Project API trong Supabase

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function App() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    let { data: betong, error } = await supabase.from('ten_bang_cua_anh').select('*');
    if (error) console.log('Lỗi rồi anh ơi:', error);
    else setData(betong);
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Siêu phẩm Bê tông Cửa Âu</h1>
      <ul>
        {data.map((item, index) => (
          <li key={index}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;