import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

// Anh tạo các component cho từng trang con nhé
const Home = () => <h1>Trang Chủ</h1>;
const BeTong = () => <h1>Trang Bê tông thương phẩm</h1>;
const DuAn = () => <h1>Trang Dự án tiêu biểu</h1>;

function App() {
  return (
    <Router>
      <nav>
        <Link to="/">Trang Chủ</Link> | 
        <Link to="/be-tong-thuong-pham"> Bê tông</Link> | 
        <Link to="/du-an-tieu-bieu"> Dự án</Link>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/be-tong-thuong-pham" element={<BeTong />} />
        <Route path="/du-an-tieu-bieu" element={<DuAn />} />
      </Routes>
    </Router>
  );
}

export default App;