import axios from 'axios';

async function testAll() {
  const items = [
    {
      name: 'LF-019 (Auditorium / Theater)',
      desc: 'A-19 | LF-019 | Theater Seats Theater | No.s | THEATER SEATS | Theatre seats with tip-up set by gravity. Wooden armrests. Accessories: under-seat wooden panel - backrest wooden panel - rows and places numbering. | As per Industry Standards | All finishes & upholstery colors to approval | https://figueras.com/seating/scala-148/ or equivalent | 20'
    },
    {
      name: 'LF-023 (Lounge Armchair)',
      desc: 'A-23 | LF-023 | Arm Chair Reception / Breakout | No.s | ARMCHAIR | Armchair with upholstered Seat, back, arm rest with prong base. | As per Industry Standards | TAUPE Fabric & Matt METAL TAUPE Frame. All finishes & upholstery colors to approval | https://bt.design/lamy-lounge-premium-s.html or equivalent | 25'
    },
    {
      name: 'LF-066 (Student Chair)',
      desc: 'A-66 | LF-066 | Student Table - 800 × 500 × 750 mm ht. CLASS ROOM-I / III /IV | No.s | STUDENT CHAIR | Multi purpose Chair. Polished Chrome Metal Frame. Polypropylene Seat and Backrest with Floor glides. Light weight and Stackable. | As per Industry Standards | Pewter Seat + Backrest. All finishes to approval | https://www.planurban.it/en/products/design-plastic-polypropylene-chairs-for-canteen-conference-outdoor-c-10/gemma-p-321 or equivalent | 45'
    }
  ];

  for (const item of items) {
    console.log(`\n========================================`);
    console.log(`🔍 Testing ${item.name}`);
    console.log(`========================================`);
    const res = await axios.post('http://localhost:3001/api/ve-match-auto', {
      description: item.desc,
      qty: 10,
      unit: 'No.s'
    });

    console.log('Status:', res.data.status);
    console.log('Match Tier:', res.data.matchTier);
    console.log('Primary Product:', `${res.data.product?.brand} - ${res.data.product?.model}`);
    console.log('Alternatives count:', res.data.alternatives?.length);
    console.log('Alternatives list:');
    res.data.alternatives?.forEach((a, i) => {
      console.log(`  ${i+1}. [${a.brand}] ${a.model} (${a.specificationFit}% Fit) - Img: ${!!a.imageUrl} - Url: ${a.imageUrl?.substring(0, 50)}...`);
    });
  }
}

testAll().catch(console.error);
