/**
 * Supabase 클라이언트 공용 초기화 (index.html, gallery.html 둘 다 이 파일을 불러온다)
 * anon key는 공개되어도 되는 키다 - 실제 접근 제어는 Supabase의 Row Level Security가 담당한다.
 */
const SUPABASE_URL = 'https://unwqrklxdyixvvsbbyml.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVud3Fya2x4ZHlpeHZ2c2JieW1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzAzNjIsImV4cCI6MjEwNTUwNjM2Mn0.jNHJsOQ1Jx15VLxj106IJnXcx0UlOTtItm8-CoZgsMw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
