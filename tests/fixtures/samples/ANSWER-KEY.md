# Sample documents: answer key

All data is fictional. Use only in a throwaway FreeTaxUSA account. Never e-file a return built from these.

## Taxpayer
| Field | Value |
| --- | --- |
| Name | Taylor A. Sample |
| SSN | 123-45-6789 (sample number; FreeTaxUSA may reject it, in which case the test stops at personal info) |
| DOB | 06/15/1990 |
| Address | 123 Sample Street, Apt 4B, Philadelphia, PA 19104 |
| Occupation | Software Tester |
| Filing status | Single |

## W-2: Acme Widget Works LLC, EIN 12-3456789
| Box | Value |
| --- | --- |
| 1 Wages | 62,500.00 |
| 2 Federal withheld | 6,850.00 |
| 3 / 5 SS and Medicare wages | 62,500.00 |
| 4 SS tax | 3,875.00 |
| 6 Medicare tax | 906.25 |
| 12a | D 3,125.00 |
| 13 | Retirement plan checked |
| 15 State / ID | PA / 1234-5678 |
| 16 State wages | 62,500.00 |
| 17 State withheld | 1,918.75 |
| 18 / 19 / 20 | 62,500.00 / 2,343.75 / PHILA |

## 1099-INT: Sample Federal Credit Union, TIN 23-4567890
Box 1 interest 412.37; everything else 0.

## 1099-DIV: Sample Brokerage Services Inc., TIN 34-5678901
1a 850.00; 1b 620.00; 2a 135.50; 7 foreign tax 12.10.

## Expected federal figures after entry (single, standard deduction, no other items)
| Line | Expected |
| --- | --- |
| Total income | 63,897.87 (62,500 + 412.37 + 850 + 135.50) |
| Federal withholding | 6,850.00 |

Exact tax and refund depend on 2025 brackets and the standard deduction as FreeTaxUSA computes them. The check is not the dollar amount but that the tool's `get_refund_estimate` matches what the browser sidebar shows, and that state and federal are reported separately.
