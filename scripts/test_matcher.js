import { matchFFE } from '../server/utils/ffe_matcher.js';
import { normalizeProducts } from '../server/utils/normalizer.js';

const mockBrands = [
  {
    name: "Arper",
    budgetTier: "high",
    products: normalizeProducts([
      { 
        model: "Paragon HIGH", 
        description: "High-back executive chair leather",
        mainCategory: "Office Seating", subCategory: "Executive Chairs"
      },
      { 
        model: "Cila Lobby", 
        description: "Elegant lobby armchair soft seating",
        mainCategory: "Office Seating", subCategory: "Lounge Chairs"
      },
      { 
        model: "Sky Round 90", 
        description: "Sky Lounge Table R:90 coffee table",
        mainCategory: "Desk & Table", subCategory: "Coffee Tables"
      },
      {
        model: "Artist Special",
        description: "Professional Theatre Artist Chair for studios",
        mainCategory: "Office Seating", subCategory: "Specialist Chairs"
      }
    ])
  },
  {
    name: "Narbutas",
    budgetTier: "mid",
    products: normalizeProducts([
      { 
        model: "Wind Task", 
        description: "Ergonomic mesh staff chair",
        mainCategory: "Office Seating", subCategory: "Staff Chairs"
      },
      { 
        model: "Master Desk", 
        description: "Staff Workstation 1600x800 white",
        mainCategory: "Desk & Table", subCategory: "Desk System"
      },
      { 
        model: "Executive North", 
        description: "Head of Desk 2000x1000 veneer",
        mainCategory: "Desk & Table", subCategory: "Manager Tables"
      },
      {
        model: "Reception X",
        description: "Reception Desk with counter",
        mainCategory: "Desk & Table", subCategory: "Reception Desks"
      },
      {
        model: "Office Pod S",
        description: "Acoustic Phone Pod for meetings",
        mainCategory: "Acoustic Solutions", subCategory: "Office Pods"
      }
    ])
  },
  {
    name: "Amara",
    budgetTier: "budgetary",
    products: normalizeProducts([
      {
        model: "Basic Operative", 
        description: "Budgetary staff chair assistant chair",
        mainCategory: "Office Seating", subCategory: "Staff Chairs"
      },
      {
        model: "Secretarial Unit",
        description: "Secretary Desk 1600x800 elegant",
        mainCategory: "Desk & Table", subCategory: "Single Desks"
      },
      {
        model: "Budget Desk",
        description: "Simple staff workstation 1200x600",
        mainCategory: "Desk & Table", subCategory: "Single Desks"
      }
    ])
  }
];

const testCases = [
  {
    description: "HEAD OF CHAIR",
    expectedModel: "Paragon HIGH",
    reason: "Should match high-end executive chair"
  },
  {
    description: "STAFF CHAIR",
    expectedModel: "Wind Task",
    reason: "Should match mid-range staff task chair"
  },
  {
    description: "SKY LOUNGE TABLE R:90",
    expectedModel: "Sky Round 90",
    reason: "Should match coffee table, NOT a chair"
  },
  {
    description: "STAFF WORKSTATION 2 80 X 160",
    expectedModel: "Master Desk",
    reason: "Should match Desk System, NOT Reception or Pod"
  },
  {
    description: "STAFF WORKSTATION 2 80 X 160 NO PARTITION",
    expectedModel: "Master Desk",
    reason: "Should match Desk System even without partition"
  },
  {
    description: "SECRETARY DESK 80 X 160",
    expectedModel: "Secretarial Unit",
    reason: "Should match Secretary Desk specifically"
  },
  {
    description: "HEAD OF DESK 80 X 160",
    expectedModel: "Executive North",
    reason: "Should match Manager/Executive table due to 'Head of'"
  },
  {
    description: "LOBBY CHAIR",
    expectedModel: "Cila Lobby",
    reason: "Should match Lounge/Lobby armchair"
  },
  {
    description: "ASSISTANT CHAIR",
    expectedModel: "Basic Operative",
    reason: "Should match basic staff chair"
  },
  {
    description: "THEATRE ARTIST CHAIR",
    expectedModel: "Artist Special",
    reason: "Should match specialist artist chair"
  }
];

async function runTests() {
  console.log("🚀 Starting Matching Engine Verification (Refined)...\n");
  let passed = 0;

  for (const tc of testCases) {
    console.log(`Testing: "${tc.description}"`);
    
    // Simulate selection logic: search across all brands for the best score
    const match = matchFFE(tc.description, mockBrands);
    
    if (match && match.model === tc.expectedModel) {
      console.log(`✅ PASSED: Matched to ${match.model} (${match.brand})`);
      passed++;
    } else {
      console.log(`❌ FAILED: Expected ${tc.expectedModel}, got ${match ? match.model : 'null'}`);
      if (match) {
        console.log(`   Actually matched: ${match.model} from ${match.brand}`);
        console.log(`   Score details: ${match.confidence}`);
      }
    }
    console.log(`   Reason: ${tc.reason}\n`);
  }

  console.log(`\n📊 Results: ${passed}/${testCases.length} tests passed.`);
}

runTests().catch(console.error);
