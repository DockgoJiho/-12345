#!/usr/bin/env python3
"""
Pinterest 데이터 HTML 파서
your_pins.html에서 핀 정보를 추출해 JSON으로 변환합니다
"""

import json
import re
import sys
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote
import base64


class PinterestHTMLParser(HTMLParser):
    """Pinterest 저장 핀 HTML 파서"""
    
    def __init__(self):
        super().__init__()
        self.pins = []
        self.in_pin = False
        self.current_pin = {}
        self.current_tag = None
        self.pin_counter = 0
        self.img_data = None
        
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        # 핀 컨테이너 시작
        if tag in ['article', 'div'] and ('class' in attrs_dict and 'pin' in attrs_dict['class']):
            self.in_pin = True
            self.current_pin = {'id': self.pin_counter}
            self.pin_counter += 1
            
        # 이미지 데이터
        elif tag == 'img' and self.in_pin:
            if 'src' in attrs_dict:
                src = attrs_dict['src']
                if src.startswith('data:image'):
                    self.current_pin['image'] = src
                    
        # 제목
        elif tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] and self.in_pin:
            self.current_tag = 'title'
            
        # 링크
        elif tag == 'a' and self.in_pin:
            if 'href' in attrs_dict:
                self.current_pin['link'] = attrs_dict['href']
                
        # 설명
        elif tag == 'p' and self.in_pin:
            self.current_tag = 'description'
    
    def handle_endtag(self, tag):
        if tag in ['article', 'div'] and self.in_pin:
            # 핀이 필요한 데이터를 가지고 있으면 저장
            if 'title' in self.current_pin or 'image' in self.current_pin:
                self.pins.append(self.current_pin)
            self.in_pin = False
            self.current_pin = {}
            self.current_tag = None
    
    def handle_data(self, data):
        if not self.in_pin:
            return
            
        data = data.strip()
        if not data:
            return
            
        if self.current_tag == 'title' and 'title' not in self.current_pin:
            self.current_pin['title'] = data
        elif self.current_tag == 'description' and 'description' not in self.current_pin:
            self.current_pin['description'] = data
            
        self.current_tag = None


def extract_pins_from_html(html_file_path):
    """HTML 파일에서 핀 추출"""
    
    try:
        with open(html_file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except Exception as e:
        print(f"❌ 파일 읽기 실패: {e}")
        return []
    
    pins = []
    
    # Pinterest 핀 링크 패턴 찾기: <a href="https://www.pinterest.com/pin/...">
    pin_link_pattern = r'<a href="(https://www\.pinterest\.com/pin/\d+/)">.*?</a>(.*?)(?=<a href="https://www\.pinterest\.com/pin/|$)'
    
    matches = re.finditer(pin_link_pattern, html_content, re.DOTALL)
    
    for match in matches:
        link = match.group(1).strip()
        pin_data = match.group(2).strip()
        
        # 각 필드 추출
        pin = {
            'id': re.search(r'/pin/(\d+)/', link).group(1) if re.search(r'/pin/(\d+)/', link) else '',
            'link': link,
        }
        
        # Title 추출
        title_match = re.search(r'Title:\s*([^<]*)<\s*br\s*>', pin_data)
        pin['title'] = title_match.group(1).strip() if title_match and title_match.group(1).strip() != 'No data' else '제목 없음'
        
        # Details (설명) 추출
        details_match = re.search(r'Details:\s*([^<]*)<\s*br\s*>', pin_data)
        if details_match and details_match.group(1).strip() != 'No data':
            pin['description'] = details_match.group(1).strip()
        else:
            pin['description'] = ''
        
        # Image ID 추출
        image_match = re.search(r'Image:\s*([^<]*)<\s*br\s*>', pin_data)
        image_id = image_match.group(1).strip() if image_match and image_match.group(1).strip() != 'No data' else ''
        # Pinterest의 image ID로 원본 크기 URL 생성
        pin['image'] = f"https://i.pinimg.com/originals/{image_id}.jpg" if image_id else ''
        
        # Created at 추출
        created_match = re.search(r'Created at:\s*([^<]*)<\s*br\s*>', pin_data)
        pin['createdAt'] = created_match.group(1).strip() if created_match else ''
        
        # 기본 필드 추가
        pin['creator'] = '내 저장 핀'
        pin['color'] = '#667eea'
        
        # 최소한 제목이나 설명이 있으면 핀으로 간주
        if pin['title'] != '제목 없음' or pin['description']:
            pins.append(pin)
    
    return pins


def save_pins_json(pins, output_path):
    """핀 데이터를 JSON 파일로 저장"""
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(pins, f, ensure_ascii=False, indent=2)
        print(f"✓ {len(pins)}개 핀 데이터를 저장했습니다: {output_path}")
        return True
    except Exception as e:
        print(f"❌ JSON 저장 실패: {e}")
        return False


def main():
    """메인 함수"""
    
    # 파일 경로
    home = Path.home()
    pins_dir = home / 'Downloads' / 'pinterest' / 'pins'
    output_json = Path(__file__).parent / 'local_pins.json'
    
    print(f"📌 Pinterest 데이터 추출 시작")
    print(f"📂 입력 폴더: {pins_dir}")
    
    if not pins_dir.exists():
        print(f"❌ 폴더를 찾을 수 없습니다: {pins_dir}")
        return False
    
    all_pins = []
    
    # 모든 HTML 파일 처리 (0001.html, 0002.html 등)
    html_files = sorted(pins_dir.glob('[0-9]*.html'))
    
    if not html_files:
        print(f"❌ HTML 파일을 찾을 수 없습니다")
        return False
    
    print(f"📄 찾은 파일: {len(html_files)}개")
    
    for html_file in html_files:
        print(f"  • {html_file.name} 파싱 중...")
        pins = extract_pins_from_html(str(html_file))
        all_pins.extend(pins)
        print(f"    → {len(pins)}개 핀 추출")
    
    if not all_pins:
        print("❌ 핀 데이터를 추출하지 못했습니다")
        return False
    
    print(f"\n✓ 총 {len(all_pins)}개의 핀을 추출했습니다")
    
    # JSON 저장
    if save_pins_json(all_pins, str(output_json)):
        print(f"\n📊 샘플 데이터 (처음 3개):")
        for i, pin in enumerate(all_pins[:3], 1):
            print(f"\n  {i}. {pin.get('title', 'N/A')}")
            print(f"     설명: {pin.get('description', 'N/A')[:50]}...")
            print(f"     링크: {pin.get('link', 'N/A')[:50]}...")
        return True
    
    return False


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
