import urllib.request
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import json
import re
import time

def get_page(url):
    """Загружает HTML-страницу по указанному URL."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Ошибка загрузки {url}: {e}")
        return None

def get_rss(url):
    """Загружает XML-RSS ленту по указанному URL."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Ошибка загрузки RSS {url}: {e}")
        return None

def extract_subunits(html, top_level_id):
    """Извлекает название подразделения первого уровня и список его вложенных единиц."""
    soup = BeautifulSoup(html, 'html.parser')
    subunits = []
    pattern = r'/organisations/([^\(]+\([^)]+\))\.html'
    
    title_tag = soup.find('title')
    if title_tag:
        top_level_name = title_tag.text.split(' | ')[0].strip()
        top_level_name = top_level_name.split(' › ')[0].strip()
    else:
        top_level_name = "Неизвестное подразделение"
    
    links = soup.find_all('a', href=True)
    for link in links:
        match = re.search(pattern, link['href'])
        if match:
            unit_id = match.group(1)
            unit_name = link.text.strip()
            if unit_id != top_level_id and unit_name:
                if not any(u['id'] == unit_id for u in subunits):
                    subunits.append({'id': unit_id, 'name': unit_name})
                    
    return top_level_name, subunits

def parse_rss_employees(rss_xml, top_level_name, second_level_name):
    """Парсит RSS-ленту и извлекает данные о сотрудниках, используя их уникальный ID."""
    employees = {}
    try:
        root = ET.fromstring(rss_xml)
        items = root.findall('.//item')
        for item in items:
            title = item.find('title').text if item.find('title') is not None else ""
            link = item.find('link').text if item.find('link') is not None else ""
            description = item.find('description').text if item.find('description') is not None else ""
            
            # Извлекаем уникальный идентификатор сотрудника из ссылки
            # Пример ссылки: https://pureportal.spbu.ru/ru/persons/--(a42afd2b-8572-466a-b4a1-12ac89713630).html
            emp_id_match = re.search(r'/persons/([^\(]+\([^)]+\))\.html', link)
            emp_id = emp_id_match.group(1) if emp_id_match else link
            
            soup = BeautifulSoup(description, 'html.parser')
            
            # Извлекаем ФИО в формате "Фамилия, Имя Отчество" из span
            name_span = soup.find('h2', class_='title')
            if name_span:
                span = name_span.find('span')
                if span:
                    raw_name = span.text.strip()
                    name = raw_name.replace(', ', ' ')
                else:
                    name = title.strip()
            else:
                name = title.strip()
                
            if not name:
                continue
                
            # Используем emp_id как ключ, чтобы полные тезки не перезаписывали друг друга
            if emp_id not in employees:
                employees[emp_id] = {
                    "id": emp_id,
                    "name": name,
                    "positions": []
                }
                
            # Извлекаем список должностей и подразделений
            orgs_list = soup.find('ul', class_='relations organisations')
            if orgs_list:
                for li in orgs_list.find_all('li'):
                    li_text = li.get_text(separator=' ', strip=True)
                    parts = li_text.split(' - ', 1)
                    if len(parts) == 2:
                        org_name = parts[0].strip()
                        position = parts[1].strip()
                    else:
                        org_name = second_level_name if second_level_name else top_level_name
                        position = li_text.strip()
                    
                    actual_second_level = org_name if org_name != top_level_name else top_level_name
                    
                    pos_entry = {
                        "top_level_unit": top_level_name,
                        "second_level_unit": actual_second_level,
                        "position": position
                    }
                    
                    # Избегаем дублирования идентичных записей о должностях внутри одного профиля
                    if pos_entry not in employees[emp_id]["positions"]:
                        employees[emp_id]["positions"].append(pos_entry)
                        
    except ET.ParseError as e:
        print(f"Ошибка парсинга XML: {e}")
        
    return employees

def main():
    top_level_ids = [
        "faculty-of-mathematics-and-mechanics(833d4dea-d7a1-44f3-8775-c71744aed7d5)",
        "faculty-of-mathemathics-and-computer-sciences(ca845b46-28e1-45c1-9b45-796f819965ef)",
        "faculty-of-applied-mathematics-and-control-processes(0435d70c-2eef-4944-90ed-649c9118ccac)",
        "faculty-of-biology(d6fddcd6-444c-4113-938a-facd8c032b6e)",
        "military-training-center(e68e06b9-81bd-4d63-b4e1-c261083e5850)",
        "faculty-of-asian-and-african-studies(b239ccdd-36c9-4f7a-8c0f-63a973167aa6)",
        "school-of-journalism-and-mass-communications(1249292b-434e-4ea8-9d38-879f8ae406ef)",
        "graduate-school-of-management(b77d55ad-a080-4836-88e9-bbb59fed96b9)",
        "institute-of-history(d2f1a469-75db-491d-8e91-5d06ab612aa6)",
        "institute-of-cognitive-studies(33563ab6-f83f-49e2-8200-f0526171a2b4)",
        "institute-of-earth-sciences(436337a2-0866-4388-9baf-340bd3a55aae)",
        "institute-of-pedagogy(5bd2f911-32ca-443d-ba1c-b0d087e4809c)",
        "institute-of-competition-and-antimonopoly-law(e50981fa-3028-4f16-b42f-af9090a9e805)",
        "institute-of-theology(b9b08962-18b5-4a18-9830-039ce31ed7f4)",
        "institute-of-philosophy(dc1e6e64-b14c-4129-91d0-71aa5168da69)",
        "institute-of-chemistry(4c45cb39-1632-49a0-b4a6-44b6d08d49da)",
        "department-of-physical-culture-and-sport(83a169ed-dc63-4ab6-9a55-cf81c1d06a4d)",
        "medical-clinic(fa16f0e6-7f91-4599-b935-e86e161b921a)",
        "--(d9296cbb-40a8-4427-8a4f-a36d7a76130a)",
        "leonhard-euler-international-mathematical-institute(cde851ed-08ff-46cc-a8a0-033054c5e87b)",
        "faculty-of-foreign-languages(b1d4d6a2-093f-4a81-a770-197a7736f065)",
        "faculty-of-arts(f7baf2d3-0f40-4d1c-aed4-1f6ef695c850)",
        "faculty-of-mathemathics-and-computer-sciences(ca845b46-28e1-45c1-9b45-796f819965ef)",
        "faculty-of-mathematics-and-mechanics(833d4dea-d7a1-44f3-8775-c71744aed7d5)",
        "school-of-international-relations(076ea2c3-3f32-418e-b15d-1e7d45cdcaf9)",
        "faculty-of-political-science(2276ef9b-8822-4559-9230-7cb7f2d14b9d)",
        "faculty-of-applied-mathematics-and-control-processes(0435d70c-2eef-4944-90ed-649c9118ccac)",
        "faculty-of-psychology(d64e3c06-0f37-451e-a504-64a994fbcb66)",
        "faculty-of-liberal-arts-and-sciences(b845136e-4987-430d-ac6e-c9a174a23daa)",
        "faculty-of-sociology(bc51e6f8-6fc9-4d6d-b39b-6e463257164b)",
        "faculty-of-physics(bbbdaec2-8b49-4e63-a317-7343570b0bf1)",
        "faculty-of-philology(26619258-c0ee-48ed-a39e-bed170df5579)",
        "faculty-of-economics(fcf852fc-ad29-4668-9f51-e1b3d335e4c9)",
        "faculty-of-law(7c2a01ab-83e8-4614-a9a4-c675927c657b)"
    ]
    
    all_employees = {}
    
    for top_id in top_level_ids:
        print(f"Обработка подразделения первого уровня: {top_id}")
        url = f"https://pureportal.spbu.ru/ru/organisations/{top_id}.html"
        html = get_page(url)
        if not html:
            continue
            
        top_name, subunits = extract_subunits(html, top_id)
        print(f"  Название: {top_name}")
        print(f"  Найдено вложенных подразделений: {len(subunits)}")
        
        units_to_process = [{'id': top_id, 'name': top_name}] + subunits
        
        for unit in units_to_process:
            unit_id = unit['id']
            unit_name = unit['name']
            rss_url = f"https://pureportal.spbu.ru/ru/organisations/{unit_id}/persons.rss?pageSize=500"
            print(f"  Загрузка RSS: {unit_name}")
            
            rss_xml = get_rss(rss_url)
            if rss_xml:
                emp_data = parse_rss_employees(rss_xml, top_name, unit_name)
                for emp_id, data in emp_data.items():
                    if emp_id not in all_employees:
                        all_employees[emp_id] = data
                    else:
                        # Объединяем должности, если сотрудник уже встречался в другой ленте
                        for pos in data['positions']:
                            if pos not in all_employees[emp_id]['positions']:
                                all_employees[emp_id]['positions'].append(pos)
            
            time.sleep(0.3) # Задержка для снижения нагрузки на сервер
                                
    result_list = list(all_employees.values())
    
    output_filename = 'employees.json'
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(result_list, f, ensure_ascii=False, indent=2)
        
    print(f"\nГотово! Данные {len(result_list)} сотрудников сохранены в файл {output_filename}")
    
    # Демонстрация первых 2 записей для проверки структуры
    print("\nПример структуры JSON (первые 2 записи):")
    for emp in result_list[:2]:
        print(json.dumps(emp, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()