import csv
import re
import glob

def clean_price(price_str):
    """Convert price from 'R$ 26,80 un' format to '26.80' format"""
    # Remove 'R$ ' prefix, ' un', ' kg' suffix
    cleaned = re.sub(r'R\$\s*', '', price_str)
    cleaned = re.sub(r'\s*(un|kg)$', '', cleaned)
    # Replace comma with dot for decimal separator
    cleaned = cleaned.replace(',', '.')
    return cleaned

# Process all CSV files matching the pattern
csv_files = glob.glob(r'd:\00_ROOT\P\TYPE-Project\project-2026-05-02-ai-price-orchestrador-website-version\dados_supermercado_*.csv')

for csv_file in csv_files:
    print(f"Processing: {csv_file}")
    
    # Read the CSV
    rows = []
    fieldnames = None
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)
    
    # Detect the correct promotion field name
    promo_field = 'is_promocao' if 'is_promocao' in fieldnames else 'is_promoção'
    
    # Write back with cleaned prices
    with open(csv_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            row['preço'] = clean_price(row['preço'])
            writer.writerow(row)
    
    print(f"Completed: {csv_file}")

print("All files reformatted successfully!")
