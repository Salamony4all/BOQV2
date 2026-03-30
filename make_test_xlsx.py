import openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws['A1'] = 'Test'
wb.save('test_upload.xlsx')
print('Created test_upload.xlsx')
