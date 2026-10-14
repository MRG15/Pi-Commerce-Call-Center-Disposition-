-- Employee ID and email per person, for the incentive payout file (Incentives → Download incentive
-- format). Seeded from the September 2026 payout sheet; fill the rest in as people join.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS email TEXT;
UPDATE agents a SET employee_id=v.eid,email=v.email FROM (VALUES
  ('sheena','68176','sheena.bhat@paytm.com'),('deepak','68124','deepak44.sharma@paytm.com'),('umesh','68177','umesh.awasthi@paytm.com'),
  ('jay','68167','jai.pathak@paytm.com'),('rajdeep','68122','rajdeep.parihar@paytm.com'),('ashish','67996','ashish15.pandey@paytm.com'),
  ('dhruv','68085','Dhruv.tyagi@paytm.com'),('priyanshi','68121','priyanshi.negi@paytm.com'),('abhishek','68033','abhishek77.singh@paytm.com'),
  ('kunal','68084','kunal.chugh@paytm.com')
) v(username,eid,email) WHERE a.username=v.username AND a.employee_id IS NULL;
