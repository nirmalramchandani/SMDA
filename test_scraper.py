import sys
import os

# Add backend to path so we can import
sys.path.append(os.path.abspath('backend'))

from ingestion.corporate_actions import scrape_corporate_action_details

# Test 1: Recent Demerger
print("Testing Recent Demerger (ITC, 06-Jan-2025):")
num, den, sym, adj = scrape_corporate_action_details("ITC", "06-Jan-2025", "DEMERGER")
print(f"Result: {num}:{den}, New Symbol: {sym}, Adj: {adj}\n")

# Test 2: 15-year old Demerger (JUBLPHARMA, 25-Nov-2010)
print("Testing 15-year-old Demerger (JUBLPHARMA, 25-Nov-2010):")
num, den, sym, adj = scrape_corporate_action_details("JUBLPHARMA", "25-Nov-2010", "DEMERGER")
print(f"Result: {num}:{den}, New Symbol: {sym}, Adj: {adj}\n")
